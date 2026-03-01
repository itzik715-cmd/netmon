"""
FastNetMon Advanced REST API client.
FNM exposes REST on port 10007 (HTTP) or 10443 (HTTPS).
Auth: HTTP Basic.
API paths: /main (config), /blackhole (blocked hosts), /hostgroup, /bgp, etc.
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

    async def _request(self, method: str, path: str, json_body: dict = None) -> httpx.Response:
        async with httpx.AsyncClient(timeout=10.0, verify=False, auth=self.auth) as client:
            return await client.request(method, f"{self.base_url}{path}", json=json_body)

    def _parse_values(self, data) -> list:
        if isinstance(data, dict) and "values" in data:
            return data["values"] if data["values"] is not None else []
        if isinstance(data, list):
            return data
        return []

    def _parse_object(self, data) -> dict:
        if isinstance(data, dict) and "object" in data:
            return data["object"]
        if isinstance(data, dict) and "success" in data:
            return data
        return data if isinstance(data, dict) else {}

    # ── Connectivity ────────────────────────────────────────────────────────

    async def ping(self) -> bool:
        try:
            resp = await self._request("GET", "/main")
            return resp.status_code == 200
        except Exception:
            return False

    async def get_status(self) -> dict:
        try:
            resp = await self._request("GET", "/main")
            resp.raise_for_status()
            data = resp.json()
            if data.get("success") and "object" in data:
                obj = data["object"]
                return {
                    "version": "FastNetMon Advanced",
                    "raw": f"sflow={'on' if obj.get('sflow') else 'off'}, ban={'on' if obj.get('enable_ban') else 'off'}",
                }
            return {"raw": str(data)[:200]}
        except Exception as e:
            logger.warning("FastNetMon get_status failed (%s): %s", self.node_label, e)
            return {}

    # ── Blackhole / Mitigations ─────────────────────────────────────────────

    async def get_blocked_hosts(self) -> list:
        """GET /blackhole — returns [{"uuid": "...", "ip": "x.x.x.x/32"}, ...]"""
        try:
            resp = await self._request("GET", "/blackhole")
            resp.raise_for_status()
            return self._parse_values(resp.json())
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

    async def unblock_host(self, uuid: str) -> bool:
        """DELETE /blackhole/{uuid} — remove a blackhole by UUID."""
        try:
            resp = await self._request("DELETE", f"/blackhole/{uuid}")
            data = resp.json() if resp.status_code == 200 else {}
            return data.get("success", resp.status_code in (200, 204))
        except Exception as e:
            logger.error("FastNetMon unblock_host(%s) failed (%s): %s", uuid, self.node_label, e)
            return False

    async def get_flowspec(self) -> list:
        """GET /flowspec — active FlowSpec rules."""
        try:
            resp = await self._request("GET", "/flowspec")
            resp.raise_for_status()
            return self._parse_values(resp.json())
        except Exception as e:
            logger.warning("FastNetMon get_flowspec failed (%s): %s", self.node_label, e)
            return []

    # ── Configuration ───────────────────────────────────────────────────────

    async def get_config(self) -> dict:
        """GET /main — full FNM global configuration."""
        try:
            resp = await self._request("GET", "/main")
            resp.raise_for_status()
            return self._parse_object(resp.json())
        except Exception as e:
            logger.warning("FastNetMon get_config failed (%s): %s", self.node_label, e)
            return {}

    # ── Hostgroups / Detection ──────────────────────────────────────────────

    async def get_hostgroups(self) -> list:
        """GET /hostgroup — list all hostgroups with thresholds."""
        try:
            resp = await self._request("GET", "/hostgroup")
            resp.raise_for_status()
            return self._parse_values(resp.json())
        except Exception as e:
            logger.warning("FastNetMon get_hostgroups failed (%s): %s", self.node_label, e)
            return []

    # ── BGP ─────────────────────────────────────────────────────────────────

    async def get_bgp_peers(self) -> list:
        """GET /bgp — list BGP peers."""
        try:
            resp = await self._request("GET", "/bgp")
            resp.raise_for_status()
            return self._parse_values(resp.json())
        except Exception as e:
            logger.warning("FastNetMon get_bgp_peers failed (%s): %s", self.node_label, e)
            return []

    # ── Traffic Counters ────────────────────────────────────────────────────

    async def get_total_traffic(self) -> list:
        """GET /total_traffic_counters — aggregate traffic counters.
        Raw format: [{"counter_name":"incoming traffic","value":123,"unit":"pps"}, ...]
        Returns grouped: [{"direction":"incoming","total_pps":...,"total_mbps":...,...}, ...]
        """
        try:
            resp = await self._request("GET", "/total_traffic_counters")
            resp.raise_for_status()
            raw = self._parse_values(resp.json())
            return self._group_traffic_counters(raw)
        except Exception as e:
            logger.warning("FastNetMon get_total_traffic failed (%s): %s", self.node_label, e)
            return []

    @staticmethod
    def _group_traffic_counters(raw: list) -> list:
        """Group flat counter entries into per-direction dicts."""
        # Map counter_name prefixes to (direction, field_prefix)
        directions: dict[str, dict] = {}
        for entry in raw:
            name = entry.get("counter_name", "")
            value = entry.get("value", 0)
            unit = entry.get("unit", "")

            # Parse "incoming traffic", "incoming tcp traffic", "outgoing udp traffic", etc.
            parts = name.split(" ")
            if len(parts) < 2:
                continue
            direction = parts[0]  # incoming, outgoing, internal, other
            if direction not in directions:
                directions[direction] = {"direction": direction}
            d = directions[direction]

            # Build the field name
            rest = " ".join(parts[1:])  # e.g. "traffic", "tcp traffic", "tcp_syn traffic", "dropped traffic", "fragmented traffic"
            rest = rest.replace(" traffic", "")  # e.g. "", "tcp", "tcp_syn", "dropped", "fragmented"
            if rest == "":
                prefix = "total"
            else:
                prefix = rest.replace(" ", "_")

            if unit == "pps":
                d[f"{prefix}_pps"] = value
            elif unit == "mbps":
                d[f"{prefix}_mbps"] = value
            elif unit == "flows":
                d[f"{prefix}_flows"] = value

        return list(directions.values())

    async def get_host_counters(self) -> list:
        """GET /host_counters — top hosts by traffic."""
        try:
            resp = await self._request("GET", "/host_counters")
            resp.raise_for_status()
            return self._parse_values(resp.json())
        except Exception as e:
            logger.warning("FastNetMon get_host_counters failed (%s): %s", self.node_label, e)
            return []

    async def get_network_counters(self) -> list:
        """GET /network_counters — per-subnet traffic counters."""
        try:
            resp = await self._request("GET", "/network_counters")
            resp.raise_for_status()
            return self._parse_values(resp.json())
        except Exception as e:
            logger.warning("FastNetMon get_network_counters failed (%s): %s", self.node_label, e)
            return []

    # ── License ─────────────────────────────────────────────────────────────

    async def get_license(self) -> dict:
        """GET /license — license info."""
        try:
            resp = await self._request("GET", "/license")
            resp.raise_for_status()
            return self._parse_object(resp.json())
        except Exception as e:
            logger.warning("FastNetMon get_license failed (%s): %s", self.node_label, e)
            return {}
