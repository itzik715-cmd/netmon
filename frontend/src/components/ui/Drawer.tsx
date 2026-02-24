import { ReactNode, useEffect } from 'react'
import { X } from 'lucide-react'

interface DrawerProps {
  open: boolean
  onClose: () => void
  title: string
  width?: string
  children: ReactNode
}

export default function Drawer({ open, onClose, title, width, children }: DrawerProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handler)
    return () => document.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <>
      <div className="drawer-overlay" onClick={onClose} />
      <div className="drawer" style={width ? { width } : undefined}>
        <div className="drawer__header">
          <h3>{title}</h3>
          <button className="modal-close" onClick={onClose}>
            <X size={14} />
          </button>
        </div>
        <div className="drawer__body">{children}</div>
      </div>
    </>
  )
}
