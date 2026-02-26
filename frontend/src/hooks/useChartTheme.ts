import { useMemo } from 'react'
import { useThemeStore } from '../store/themeStore'

export function useChartTheme() {
  const theme = useThemeStore((s) => s.theme)
  return useMemo(() => {
    const cs = getComputedStyle(document.documentElement)
    return {
      grid: cs.getPropertyValue('--chart-grid').trim() || '#f0f0f0',
      tick: cs.getPropertyValue('--chart-tick').trim() || '#64748b',
      tooltipBg: cs.getPropertyValue('--chart-tooltip-bg').trim() || '#ffffff',
      tooltipBorder: cs.getPropertyValue('--chart-tooltip-border').trim() || '#e2e8f0',
      tooltipText: cs.getPropertyValue('--chart-tooltip-text').trim() || '#1e293b',
    }
  }, [theme])
}
