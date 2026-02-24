import { useState, ReactNode } from 'react'
import { LucideIcon, ArrowUp, ArrowDown } from 'lucide-react'
import Skeleton from './Skeleton'

export interface Column<T> {
  key: string
  label: string
  sortable?: boolean
  render?: (row: T, index: number) => ReactNode
}

interface DataTableProps<T> {
  columns: Column<T>[]
  data: T[]
  loading?: boolean
  emptyIcon?: LucideIcon
  emptyTitle?: string
  emptyDescription?: string
  onRowClick?: (row: T) => void
  rowKey?: (row: T) => string | number
}

export default function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  loading,
  emptyIcon: EmptyIcon,
  emptyTitle = 'No data',
  emptyDescription,
  onRowClick,
  rowKey,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null)
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc')

  const handleSort = (key: string) => {
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))
    } else {
      setSortKey(key)
      setSortDir('asc')
    }
  }

  const sortedData = sortKey
    ? [...data].sort((a, b) => {
        const aVal = a[sortKey]
        const bVal = b[sortKey]
        if (aVal == null && bVal == null) return 0
        if (aVal == null) return 1
        if (bVal == null) return -1
        if (typeof aVal === 'number' && typeof bVal === 'number') {
          return sortDir === 'asc' ? aVal - bVal : bVal - aVal
        }
        const aStr = String(aVal).toLowerCase()
        const bStr = String(bVal).toLowerCase()
        const cmp = aStr.localeCompare(bStr)
        return sortDir === 'asc' ? cmp : -cmp
      })
    : data

  if (loading) {
    return (
      <div className="data-table">
        <table>
          <thead>
            <tr>
              {columns.map((col) => (
                <th key={col.key}>{col.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: 5 }, (_, i) => (
              <tr key={i}>
                {columns.map((col) => (
                  <td key={col.key}>
                    <Skeleton variant="text" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    )
  }

  if (data.length === 0) {
    return (
      <div className="empty-state">
        {EmptyIcon && (
          <div className="empty-state__icon">
            <EmptyIcon size={40} />
          </div>
        )}
        <div className="empty-state__title">{emptyTitle}</div>
        {emptyDescription && <div className="empty-state__description">{emptyDescription}</div>}
      </div>
    )
  }

  return (
    <div className="data-table">
      <table>
        <thead>
          <tr>
            {columns.map((col) => (
              <th
                key={col.key}
                className={col.sortable ? 'sortable' : ''}
                onClick={col.sortable ? () => handleSort(col.key) : undefined}
              >
                <span className="th-content">
                  {col.label}
                  {col.sortable && sortKey === col.key && (
                    <span className="sort-indicator">
                      {sortDir === 'asc' ? <ArrowUp size={12} /> : <ArrowDown size={12} />}
                    </span>
                  )}
                </span>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sortedData.map((row, i) => (
            <tr
              key={rowKey ? rowKey(row) : i}
              onClick={onRowClick ? () => onRowClick(row) : undefined}
              className={onRowClick ? 'clickable' : ''}
            >
              {columns.map((col) => (
                <td key={col.key}>
                  {col.render ? col.render(row, i) : (row[col.key] as ReactNode) ?? '—'}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
