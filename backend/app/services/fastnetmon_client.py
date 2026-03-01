"""
FastNetMon Advanced REST API client.
FNM exposes REST on port 10007 (HTTP) or 10443 (HTTPS).
Auth: HTTP Basic.
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
            resp = await self._request("GET", "/api/v1")
            return resp.status_code == 200
        except Exception:
            return False

    async def get_status(self) -> dict:
        """GET /api/v1 — returns FNM version and status."""
        try:
            resp = await self._request("GET", "/api/v1")
            resp.raise_for_status()
            return resp.json() if resp.headers.get("content-type", "").startswith("application/json") else {"raw": resp.text}
        except Exception as e:
            logger.warning("FastNetMon get_status failed (%s): %s", self.node_label, e)
            return {}

    async def get_blocked_hosts(self) -> list:
        """GET /api/v1/blackhole — returns currently blackholed IPs."""
        try:
            resp = await self._request("GET", "/api/v1/blackhole")
            resp.raise_for_status()
            data = resp.json() if resp.headers.get("content-type", "").startswith("application/json") else resp.text
            if isinstance(data, list):
                return data
            if isinstance(data, str):
                # FNM may return newline-separated IPs
                return [ip.strip() for ip in data.strip().splitlines() if ip.strip()]
            return []
        except Exception as e:
            logger.warning("FastNetMon get_blocked_hosts failed (%s): %s", self.node_label, e)
            return []

    async def block_host(self, ip: str) -> bool:
        """PUT /api/v1/blackhole/{ip} — manually blackhole an IP."""
        try:
            resp = await self._request("PUT", f"/api/v1/blackhole/{ip}")
            return resp.status_code in (200, 201, 204)
        except Exception as e:
            logger.error("FastNetMon block_host(%s) failed (%s): %s", ip, self.node_label, e)
            return False

    async def unblock_host(self, ip: str) -> bool:
        """DELETE /api/v1/blackhole/{ip} — remove a blackhole."""
        try:
            resp = await self._request("DELETE", f"/api/v1/blackhole/{ip}")
            return resp.status_code in (200, 204)
        except Exception as e:
            logger.error("FastNetMon unblock_host(%s) failed (%s): %s", ip, self.node_label, e)
            return False
