import { useCallback } from 'react'
import { Monitor } from 'lucide-react'

interface NocViewButtonProps {
  pageId: string
}

export default function NocViewButton({ pageId }: NocViewButtonProps) {
  const handleClick = useCallback(() => {
    const url = window.location.origin + window.location.pathname + '?noc=1'
    window.open(
      url,
      `netmon-noc-${pageId}`,
      'width=1920,height=1080,menubar=no,toolbar=no,location=no,status=no,scrollbars=yes,resizable=yes'
    )
  }, [pageId])

  return (
    <button
      onClick={handleClick}
      className="btn btn-outline btn-sm"
      title="Open in NOC View — fullscreen, no sidebar"
      style={{ gap: 6 }}
    >
      <Monitor size={14} />
      NOC View
    </button>
  )
}
