"""
PDU Power Poller Service
Polls APC PDU devices via SNMP for power metrics, bank data, and outlet states.
Supports both Gen2 (rPDU2) and Gen1 (rPDU) OID sets.
"""
import logging
from datetime import datetime, timezone
from typing import Optional, Any
from pysnmp.hlapi.asyncio import (
    set_cmd, SnmpEngine, UdpTransportTarget, ContextData,
    ObjectType, ObjectIdentity, Integer32,
)
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update as sql_update
from sqlalchemy.dialects.postgresql import insert as pg_insert
from app.config import settings
from app.models.device import Device
from app.models.pdu import PduMetric, PduBank, PduBankMetric, PduOutlet
from app.services.snmp_poller import snmp_get, make_auth_data, _close_engine

logger = logging.getLogger(__name__)

# ═══ APC rPDU2 (Gen2) OIDs ═══
# Device-level status  (rPDU2DeviceStatusEntry  .26.4.3.1)
OID_PDU2_POWER           = "1.3.6.1.4.1.318.1.1.26.4.3.1.5"     # decaWatts (×10 → Watts)
OID_PDU2_ENERGY          = "1.3.6.1.4.1.318.1.1.26.4.3.1.6"     # kWh × 10

# Phase properties  (rPDU2PhaseConfigEntry  .26.6.1.1)
OID_PDU2_PHASE_NEAR_OL   = "1.3.6.1.4.1.318.1.1.26.6.1.1.6"    # Near-overload Amps × 10
OID_PDU2_PHASE_OVERLOAD  = "1.3.6.1.4.1.318.1.1.26.6.1.1.7"    # Overload Amps × 10

# Phase-level status  (rPDU2PhaseStatusEntry  .26.6.3.1)
OID_PDU2_PHASE_CURRENT   = "1.3.6.1.4.1.318.1.1.26.6.3.1.5"    # Amps × 10
OID_PDU2_PHASE_VOLTAGE   = "1.3.6.1.4.1.318.1.1.26.6.3.1.6"    # Volts
OID_PDU2_PHASE_POWER     = "1.3.6.1.4.1.318.1.1.26.6.3.1.7"    # decaWatts (×10 → Watts)

# Bank-level
OID_PDU2_BANK_CURRENT    = "1.3.6.1.4.1.318.1.1.26.8.3.1.5"    # Amps × 10
OID_PDU2_BANK_POWER      = "1.3.6.1.4.1.318.1.1.26.8.3.1.6"    # Watts
OID_PDU2_BANK_STATE      = "1.3.6.1.4.1.318.1.1.26.8.3.1.3"    # State
OID_PDU2_BANK_NEAR_OL    = "1.3.6.1.4.1.318.1.1.26.8.1.1.4"    # Near-overload Amps × 10
OID_PDU2_BANK_OVERLOAD   = "1.3.6.1.4.1.318.1.1.26.8.1.1.5"    # Overload Amps × 10

# Outlet-level (switched PDUs)
OID_PDU2_OUTLET_NAME     = "1.3.6.1.4.1.318.1.1.26.9.2.1.1.3"
OID_PDU2_OUTLET_STATE    = "1.3.6.1.4.1.318.1.1.26.9.2.2.1.5"  # 1=on, 2=off
OID_PDU2_OUTLET_CURRENT  = "1.3.6.1.4.1.318.1.1.26.9.2.2.1.6"  # Amps × 10
OID_PDU2_OUTLET_POWER    = "1.3.6.1.4.1.318.1.1.26.9.2.2.1.7"  # Watts
OID_PDU2_OUTLET_BANK     = "1.3.6.1.4.1.318.1.1.26.9.2.1.1.6"  # Bank assignment

# Temperature/humidity sensor  (rPDU2SensorTempHumidityStatusEntry  .26.10.2.2.1)
OID_PDU2_TEMP_STATUS     = "1.3.6.1.4.1.318.1.1.26.10.2.2.1.5"  # 1=ok, 2=not present (col 5)
OID_PDU2_TEMP            = "1.3.6.1.4.1.318.1.1.26.10.2.2.1.8"  # °C × 10  (col 8)
OID_PDU2_HUMID_STATUS    = "1.3.6.1.4.1.318.1.1.26.10.2.2.1.6"  # 1=ok, 2=not present (col 6)
OID_PDU2_HUMIDITY        = "1.3.6.1.4.1.318.1.1.26.10.2.2.1.9"  # % × 10   (col 9)

# ═══ APC rPDU Gen1 fallback OIDs ═══
OID_PDU1_POWER           = "1.3.6.1.4.1.318.1.1.12.1.16.0"      # rPDUIdentDevicePowerWatts
OID_PDU1_LOAD            = "1.3.6.1.4.1.318.1.1.12.2.3.1.1.2"   # rPDULoadStatusLoad (Amps × 10)
OID_PDU1_OUTLET_CTL      = "1.3.6.1.4.1.318.1.1.4.4.2.1.3"      # sPDUOutletCtl
OID_PDU1_OUTLET_NAME     = "1.3.6.1.4.1.318.1.1.4.5.2.1.3"      # sPDUOutletName

# Outlet control values for SNMP SET
OUTLET_CMD_ON  = 1
OUTLET_CMD_OFF = 2


def _safe_float(raw: Any) -> Optional[float]:
    """Convert SNMP value to float, return None on failure."""
    if raw is None:
        return None
    try:
        return float(raw)
    except (ValueError, TypeError):
        return None


async def poll_pdu(device: Device, db: AsyncSession, engine: Optional[SnmpEngine] = None) -> bool:
    """Poll an APC PDU device via SNMP and store metrics.
    Returns True on success, False on failure.
    """
    _own_engine = engine is None
    if _own_engine:
        engine = SnmpEngine()
    try:
        return await _do_poll_pdu(device, db, engine)
    except Exception as e:
        logger.error("PDU poll error for %s: %s", device.hostname, e)
        return False
    finally:
        if _own_engine:
            _close_engine(engine)


async def _do_poll_pdu(device: Device, db: AsyncSession, engine: SnmpEngine) -> bool:
    """Inner poll logic — engine lifecycle managed by caller."""
    # 1. Try Gen2 OIDs first (rPDU2)
    power_raw = await snmp_get(device, f"{OID_PDU2_POWER}.1", engine)

    # 2. If Gen2 fails, fall back to Gen1
    is_gen2 = power_raw is not None
    if not is_gen2:
        power_raw = await snmp_get(device, OID_PDU1_POWER, engine)

    power_watts = _safe_float(power_raw)
    if power_watts is None:
        logger.warning("PDU %s: no power data from Gen1 or Gen2 OIDs", device.hostname)
        return False

    # Gen2 power is in decaWatts (×10), convert to Watts
    if is_gen2:
        power_watts *= 10

    # 3. Get energy (kWh) — Gen2 returns kWh × 10
    energy_raw = await snmp_get(device, f"{OID_PDU2_ENERGY}.1", engine) if is_gen2 else None
    energy_kwh = _safe_float(energy_raw)
    if energy_kwh is not None:
        energy_kwh /= 10.0

    # 4. Apparent power and power factor — compute from phase data below
    apparent_power_va = None
    power_factor = None

    # 5. Get phase data
    phases = {}
    if is_gen2:
        for phase_num in [1, 2, 3]:
            current = await snmp_get(device, f"{OID_PDU2_PHASE_CURRENT}.{phase_num}", engine)
            voltage = await snmp_get(device, f"{OID_PDU2_PHASE_VOLTAGE}.{phase_num}", engine)
            phase_power = await snmp_get(device, f"{OID_PDU2_PHASE_POWER}.{phase_num}", engine)
            if current is not None:
                c = _safe_float(current)
                v = _safe_float(voltage)
                p = _safe_float(phase_power)
                # Current is Amps × 10
                if c is not None:
                    c /= 10.0
                # Phase power is in decaWatts (×10), convert to Watts
                if p is not None:
                    p *= 10
                phases[phase_num] = {"current": c, "voltage": v, "power": p}

    # Compute apparent power (sum of V×I per phase) and power factor
    if phases:
        total_va = 0
        for ph in phases.values():
            if ph["current"] is not None and ph["voltage"] is not None:
                total_va += ph["current"] * ph["voltage"]
        if total_va > 0:
            apparent_power_va = total_va
            power_factor = power_watts / total_va if power_watts else None

    # 6. Get temperature and humidity (check sensor status first)
    temperature = None
    humidity = None
    if is_gen2:
        temp_status = await snmp_get(device, f"{OID_PDU2_TEMP_STATUS}.1", engine)
        if str(temp_status) == "1":  # 1 = sensor ok
            temp_raw = await snmp_get(device, f"{OID_PDU2_TEMP}.1", engine)
            temperature = _safe_float(temp_raw)
            if temperature is not None:
                temperature /= 10.0  # °C × 10

        humid_status = await snmp_get(device, f"{OID_PDU2_HUMID_STATUS}.1", engine)
        if str(humid_status) == "1":  # 1 = sensor ok
            humidity_raw = await snmp_get(device, f"{OID_PDU2_HUMIDITY}.1", engine)
            humidity = _safe_float(humidity_raw)
            if humidity is not None:
                humidity /= 10.0  # % × 10

    # 7. Get overload thresholds from phase config (Amps × 10)
    # Convert to Watts using average voltage for rated power calculation
    near_overload = None
    overload = None
    rated = None
    if is_gen2:
        ol_raw = await snmp_get(device, f"{OID_PDU2_PHASE_OVERLOAD}.1", engine)
        nol_raw = await snmp_get(device, f"{OID_PDU2_PHASE_NEAR_OL}.1", engine)
        ol_amps = _safe_float(ol_raw)
        nol_amps = _safe_float(nol_raw)
        # Phase config thresholds are in whole Amps (NOT ×10)
        # Convert to Watts using average voltage for rated power calculation
        avg_voltage = 230.0  # default
        voltages = [ph["voltage"] for ph in phases.values() if ph.get("voltage")]
        if voltages:
            avg_voltage = sum(voltages) / len(voltages)
        num_phases = len(phases) or 1
        if ol_amps is not None:
            overload = ol_amps * avg_voltage * num_phases  # Watts
            rated = overload
        if nol_amps is not None:
            near_overload = nol_amps * avg_voltage * num_phases  # Watts

    # 8. Calculate load percentage — CRITICAL: guard against division by zero
    load_pct = None
    if power_watts is not None and rated is not None and rated > 0:
        load_pct = (power_watts / rated) * 100

    # 9. Store metric
    metric = PduMetric(
        device_id=device.id,
        power_watts=power_watts,
        energy_kwh=energy_kwh,
        apparent_power_va=apparent_power_va,
        power_factor=power_factor,
        temperature_c=temperature,
        humidity_pct=humidity,
        load_pct=load_pct,
        rated_power_watts=rated,
        near_overload_watts=near_overload,
        overload_watts=overload,
        phase1_current_amps=phases.get(1, {}).get("current"),
        phase1_voltage_v=phases.get(1, {}).get("voltage"),
        phase1_power_watts=phases.get(1, {}).get("power"),
        phase2_current_amps=phases.get(2, {}).get("current"),
        phase2_voltage_v=phases.get(2, {}).get("voltage"),
        phase2_power_watts=phases.get(2, {}).get("power"),
        phase3_current_amps=phases.get(3, {}).get("current"),
        phase3_voltage_v=phases.get(3, {}).get("voltage"),
        phase3_power_watts=phases.get(3, {}).get("power"),
    )
    db.add(metric)

    # 10. Update device status
    await db.execute(
        sql_update(Device)
        .where(Device.id == device.id)
        .values(status="up", last_seen=datetime.now(timezone.utc))
    )

    # 11. Poll banks (Gen2 only)
    if is_gen2:
        await poll_pdu_banks(device, db, engine)

    # 12. Poll outlets
    await poll_pdu_outlets(device, db, engine, is_gen2)

    await db.commit()
    logger.debug("PDU %s: polled — %.0fW, load=%.1f%%", device.hostname, power_watts or 0, load_pct or 0)
    return True


async def poll_pdu_banks(device: Device, db: AsyncSession, engine: SnmpEngine):
    """Poll bank-level data and upsert into pdu_banks + pdu_bank_metrics tables."""
    bank_num = 1
    while bank_num <= 12:  # Max 12 banks
        current_raw = await snmp_get(device, f"{OID_PDU2_BANK_CURRENT}.{bank_num}", engine)
        if current_raw is None:
            break  # No more banks

        current_amps = _safe_float(current_raw)
        if current_amps is not None:
            current_amps /= 10.0  # Amps × 10

        power_raw = await snmp_get(device, f"{OID_PDU2_BANK_POWER}.{bank_num}", engine)
        power_watts = _safe_float(power_raw)
        if power_watts is not None:
            power_watts *= 10  # decaWatts → Watts

        near_ol_raw = await snmp_get(device, f"{OID_PDU2_BANK_NEAR_OL}.{bank_num}", engine)
        near_ol = _safe_float(near_ol_raw)
        if near_ol is not None:
            near_ol /= 10.0  # Amps × 10

        overload_raw = await snmp_get(device, f"{OID_PDU2_BANK_OVERLOAD}.{bank_num}", engine)
        overload = _safe_float(overload_raw)
        if overload is not None:
            overload /= 10.0  # Amps × 10

        # Upsert into PduBank
        stmt = pg_insert(PduBank).values(
            device_id=device.id,
            bank_number=bank_num,
            name=f"Bank {bank_num}",
            current_amps=current_amps,
            power_watts=power_watts,
            near_overload_amps=near_ol,
            overload_amps=overload,
        ).on_conflict_do_update(
            constraint="uq_pdu_bank_dev_num",
            set_={
                "current_amps": current_amps,
                "power_watts": power_watts,
                "near_overload_amps": near_ol,
                "overload_amps": overload,
            }
        )
        await db.execute(stmt)

        # Insert historical bank metric
        db.add(PduBankMetric(
            device_id=device.id,
            bank_number=bank_num,
            current_amps=current_amps,
            power_watts=power_watts,
        ))

        bank_num += 1


async def poll_pdu_outlets(device: Device, db: AsyncSession, engine: SnmpEngine, is_gen2: bool = True):
    """Poll outlet states and upsert into pdu_outlets table."""
    state_oid = OID_PDU2_OUTLET_STATE if is_gen2 else OID_PDU1_OUTLET_CTL
    name_oid = OID_PDU2_OUTLET_NAME if is_gen2 else OID_PDU1_OUTLET_NAME

    outlet_num = 1
    while outlet_num <= 48:  # Max 48 outlets
        state_raw = await snmp_get(device, f"{state_oid}.{outlet_num}", engine)
        if state_raw is None:
            break  # No more outlets
        # Stop on "No Such Instance" responses (SNMP returns string error)
        state_str = str(state_raw)
        if "No Such" in state_str or "noSuch" in state_str:
            break

        # APC rPDU2 outlet states: 1=on, 2=off
        # State 3+ can occur on metered-only (non-switchable) outlets — treat as "on"
        if state_str == "1":
            state = "on"
        elif state_str == "2":
            state = "off"
        else:
            # State 3+ : metered outlet (always on, not switchable)
            state = "on"

        current_raw = None
        power_raw = None
        bank_raw = None
        if is_gen2:
            current_raw = await snmp_get(device, f"{OID_PDU2_OUTLET_CURRENT}.{outlet_num}", engine)
            power_raw = await snmp_get(device, f"{OID_PDU2_OUTLET_POWER}.{outlet_num}", engine)
            bank_raw = await snmp_get(device, f"{OID_PDU2_OUTLET_BANK}.{outlet_num}", engine)

        current_amps = _safe_float(current_raw)
        if current_amps is not None:
            current_amps /= 10.0  # Amps × 10

        power_watts = _safe_float(power_raw)

        bank_number = None
        if bank_raw is not None:
            try:
                bv = int(bank_raw)
                if bv > 0:
                    bank_number = bv
            except (ValueError, TypeError):
                pass

        name_raw = await snmp_get(device, f"{name_oid}.{outlet_num}", engine)
        name_str = str(name_raw) if name_raw else ""
        # Skip invalid SNMP responses as names
        if "No Such" in name_str or not name_str:
            name = f"Outlet {outlet_num}"
        else:
            name = name_str

        # Upsert
        stmt = pg_insert(PduOutlet).values(
            device_id=device.id,
            outlet_number=outlet_num,
            bank_number=bank_number,
            name=name,
            state=state,
            current_amps=current_amps,
            power_watts=power_watts,
        ).on_conflict_do_update(
            constraint="uq_pdu_outlet_dev_num",
            set_={
                "state": state,
                "current_amps": current_amps,
                "power_watts": power_watts,
                "name": name,
                "bank_number": bank_number,
            }
        )
        await db.execute(stmt)
        outlet_num += 1


async def toggle_pdu_outlet(
    device: Device,
    outlet_number: int,
    new_state: str,
    db: AsyncSession,
    engine: Optional[SnmpEngine] = None,
) -> bool:
    """Toggle a PDU outlet on or off via SNMP SET.
    new_state should be 'on' or 'off'.
    Returns True on success."""
    cmd = OUTLET_CMD_ON if new_state == "on" else OUTLET_CMD_OFF
    oid = f"{OID_PDU2_OUTLET_STATE}.{outlet_number}"

    success = await snmp_set_pdu(device, oid, Integer32(cmd), engine)
    if success:
        # Update DB record
        stmt = (
            sql_update(PduOutlet)
            .where(PduOutlet.device_id == device.id, PduOutlet.outlet_number == outlet_number)
            .values(state=new_state)
        )
        await db.execute(stmt)
        await db.commit()
    return success


async def snmp_set_pdu(device: Device, oid: str, value, engine: Optional[SnmpEngine] = None) -> bool:
    """SNMP SET for PDU outlet control."""
    _own_engine = engine is None
    if _own_engine:
        engine = SnmpEngine()
    try:
        auth_data = make_auth_data(device)
        transport = await UdpTransportTarget.create(
            (device.ip_address, device.snmp_port or 161),
            timeout=settings.SNMP_TIMEOUT,
            retries=settings.SNMP_RETRIES,
        )
        error_indication, error_status, error_index, var_binds = await set_cmd(
            engine, auth_data, transport, ContextData(),
            ObjectType(ObjectIdentity(oid), value),
        )
        if error_indication:
            logger.error("SNMP SET error for %s/%s: %s", device.ip_address, oid, error_indication)
            return False
        if error_status:
            logger.error("SNMP SET status error for %s/%s: %s at %s",
                         device.ip_address, oid, error_status.prettyPrint(),
                         var_binds[int(error_index) - 1][0] if error_index else "?")
            return False
        return True
    except Exception as e:
        logger.error("SNMP SET exception for %s/%s: %s", device.ip_address, oid, e)
        return False
    finally:
        if _own_engine:
            _close_engine(engine)
