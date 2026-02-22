from fastapi import APIRouter, Depends, HTTPException, Request, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from typing import List, Optional
from app.database import get_db
from app.models.device import Device, DeviceLocation
from app.models.interface import Interface
from app.services.auth import log_audit
from app.middleware.rbac import get_current_user, require_admin, require_operator_or_above
from app.schemas.device import (
    DeviceCreate, DeviceUpdate, DeviceResponse,
    LocationCreate, LocationResponse
)
from app.models.user import User

router = APIRouter(prefix="/api/devices", tags=["Devices"])


@router.get("/", response_model=List[DeviceResponse])
async def list_devices(
    location_id: Optional[int] = None,
    status: Optional[str] = None,
    device_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    query = select(Device).where(Device.is_active == True)
    if location_id:
        query = query.where(Device.location_id == location_id)
    if status:
        query = query.where(Device.status == status)
    if device_type:
        query = query.where(Device.device_type == device_type)

    result = await db.execute(query)
    devices = result.scalars().all()

    # Load location and count interfaces
    device_list = []
    for device in devices:
        await db.refresh(device, ["location"])
        count_result = await db.execute(
            select(func.count(Interface.id)).where(Interface.device_id == device.id)
        )
        interface_count = count_result.scalar() or 0
        d = DeviceResponse.model_validate(device)
        d.interface_count = interface_count
        device_list.append(d)

    return device_list


@router.post("/", response_model=DeviceResponse)
async def create_device(
    request: Request,
    payload: DeviceCreate,
    background_tasks: BackgroundTasks,
    current_user: User = Depends(require_operator_or_above()),
    db: AsyncSession = Depends(get_db),
):
    # Check IP uniqueness
    existing = await db.execute(select(Device).where(Device.ip_address == payload.ip_address))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Device with this IP already exists")

    device = Device(**payload.dict())
    db.add(device)
    await db.commit()
    await db.refresh(device, ["location"])

    await log_audit(
        db, "device_created",
        user_id=current_user.id, username=current_user.username,
        resource_type="device", resource_id=str(device.id),
        details=f"Created device: {device.hostname} ({device.ip_address})",
        source_ip=request.client.host if request.client else None,
    )

    # Trigger initial discovery in background
    background_tasks.add_task(discover_and_poll, device.id)

    d = DeviceResponse.model_validate(device)
    d.interface_count = 0
    return d


@router.get("/summary")
async def get_summary(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    """Dashboard summary statistics."""
    total = await db.execute(select(func.count(Device.id)).where(Device.is_active == True))
    up = await db.execute(select(func.count(Device.id)).where(Device.status == "up", Device.is_active == True))
    down = await db.execute(select(func.count(Device.id)).where(Device.status == "down", Device.is_active == True))
    iface_count = await db.execute(select(func.count(Interface.id)))

    return {
        "total_devices": total.scalar() or 0,
        "devices_up": up.scalar() or 0,
        "devices_down": down.scalar() or 0,
        "total_interfaces": iface_count.scalar() or 0,
    }


@router.get("/{device_id}", response_model=DeviceResponse)
async def get_device(
    device_id: int,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(get_current_user),
):
    result = await db.execute(select(Device).where(Device.id == device_id, Device.is_active == True))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    await db.refresh(device, ["location"])
    count_result = await db.execute(
        select(func.count(Interface.id)).where(Interface.device_id == device.id)
    )
    d = DeviceResponse.model_validate(device)
    d.interface_count = count_result.scalar() or 0
    return d


@router.patch("/{device_id}", response_model=DeviceResponse)
async def update_device(
    request: Request,
    device_id: int,
    payload: DeviceUpdate,
    current_user: User = Depends(require_operator_or_above()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    update_data = payload.dict(exclude_unset=True)
    for key, value in update_data.items():
        setattr(device, key, value)
    await db.commit()
    await db.refresh(device, ["location"])

    await log_audit(
        db, "device_updated",
        user_id=current_user.id, username=current_user.username,
        resource_type="device", resource_id=str(device_id),
        source_ip=request.client.host if request.client else None,
    )

    d = DeviceResponse.model_validate(device)
    count_result = await db.execute(
        select(func.count(Interface.id)).where(Interface.device_id == device.id)
    )
    d.interface_count = count_result.scalar() or 0
    return d


@router.delete("/{device_id}")
async def delete_device(
    request: Request,
    device_id: int,
    current_user: User = Depends(require_admin()),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")

    device.is_active = False
    await db.commit()

    await log_audit(
        db, "device_deleted",
        user_id=current_user.id, username=current_user.username,
        resource_type="device", resource_id=str(device_id),
        details=f"Deleted: {device.hostname}",
        source_ip=request.client.host if request.client else None,
    )
    return {"message": "Device deleted"}


@router.post("/{device_id}/poll")
async def manual_poll(
    device_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above()),
):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    background_tasks.add_task(discover_and_poll, device_id)
    return {"message": "Poll scheduled"}


@router.post("/{device_id}/discover")
async def discover_device_interfaces(
    device_id: int,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    _: User = Depends(require_operator_or_above()),
):
    result = await db.execute(select(Device).where(Device.id == device_id))
    device = result.scalar_one_or_none()
    if not device:
        raise HTTPException(status_code=404, detail="Device not found")
    background_tasks.add_task(run_discovery, device_id)
    return {"message": "Interface discovery started"}


# Locations
@router.get("/locations/list", response_model=List[LocationResponse])
async def list_locations(db: AsyncSession = Depends(get_db), _: User = Depends(get_current_user)):
    result = await db.execute(select(DeviceLocation))
    return result.scalars().all()


@router.post("/locations/", response_model=LocationResponse, dependencies=[Depends(require_admin())])
async def create_location(payload: LocationCreate, db: AsyncSession = Depends(get_db)):
    loc = DeviceLocation(**payload.dict())
    db.add(loc)
    await db.commit()
    await db.refresh(loc)
    return loc


async def discover_and_poll(device_id: int):
    """Background task: discover interfaces then poll."""
    from app.database import AsyncSessionLocal
    from app.services.snmp_poller import discover_interfaces, poll_device
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Device).where(Device.id == device_id))
        device = result.scalar_one_or_none()
        if device:
            await discover_interfaces(device, db)
            await poll_device(device, db)


async def run_discovery(device_id: int):
    from app.database import AsyncSessionLocal
    from app.services.snmp_poller import discover_interfaces
    async with AsyncSessionLocal() as db:
        result = await db.execute(select(Device).where(Device.id == device_id))
        device = result.scalar_one_or_none()
        if device:
            count = await discover_interfaces(device, db)
            return count
