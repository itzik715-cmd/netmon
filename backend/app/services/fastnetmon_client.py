"""
FastNetMon Advanced REST API client.
FNM exposes REST on port 10007 (HTTP) or 10443 (HTTPS).
Auth: HTTP Basic.
API paths: /main (config), /blackhole (blocked hosts), etc.
Response format: {"success": bool, "values": [...]} or {"success": bool, "object": {...}}
"""
import httpx
import logging

logger = logging.getLogger(__name__)


class FastNetMonClient:
    def __init__(self, host: str, port: int, username: str, password: str, use_ssl: bool = False):
        scheme = "https" if use_ssl else "http"
        self.base_url = f"{scheme}://{host}:{port}"
        self.auth = (username, password)
        self.node_label = f"{host}:{port}"

    async def _request(self, method: str, path: str) -> httpx.Response:
        async with httpx.AsyncClient(timeout=5.0, verify=False, auth=self.auth) as client:
            return await client.request(method, f"{self.base_url}{path}")

    async def ping(self) -> bool:
        """Test connectivity — return True if reachable."""
        try:
            resp = await self._request("GET", "/main")
            return resp.status_code == 200
        except Exception:
            return False

    async def get_status(self) -> dict:
        """GET /main — returns FNM config and status."""
        try:
            resp = await self._request("GET", "/main")
            resp.raise_for_status()
            data = resp.json()
            if data.get("success") and "object" in data:
                obj = data["object"]
                return {"version": "FastNetMon Advanced", "raw": f"sflow={'on' if obj.get('sflow') else 'off'}, ban={'on' if obj.get('enable_ban') else 'off'}"}
            return {"raw": str(data)[:200]}
        except Exception as e:
            logger.warning("FastNetMon get_status failed (%s): %s", self.node_label, e)
            return {}

    async def get_blocked_hosts(self) -> list:
        """GET /blackhole — returns currently blackholed IPs."""
        try:
            resp = await self._request("GET", "/blackhole")
            resp.raise_for_status()
            data = resp.json()
            # FNM returns {"success": true, "values": ["1.2.3.4", ...]}
            if isinstance(data, dict) and "values" in data:
                return data["values"]
            if isinstance(data, list):
                return data
            return []
        except Exception as e:
            logger.warning("FastNetMon get_blocked_hosts failed (%s): %s", self.node_label, e)
            return []

    async def block_host(self, ip: str) -> bool:
        """PUT /blackhole/{ip} — manually blackhole an IP."""
        try:
            resp = await self._request("PUT", f"/blackhole/{ip}")
            data = resp.json() if resp.status_code == 200 else {}
            return data.get("success", resp.status_code in (200, 201, 204))
        except Exception as e:
            logger.error("FastNetMon block_host(%s) failed (%s): %s", ip, self.node_label, e)
            return False

    async def unblock_host(self, ip: str) -> bool:
        """DELETE /blackhole/{ip} — remove a blackhole."""
        try:
            resp = await self._request("DELETE", f"/blackhole/{ip}")
            data = resp.json() if resp.status_code == 200 else {}
            return data.get("success", resp.status_code in (200, 204))
        except Exception as e:
            logger.error("FastNetMon unblock_host(%s) failed (%s): %s", ip, self.node_label, e)
            return False
