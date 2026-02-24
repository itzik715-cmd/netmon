interface SkeletonProps {
  variant?: 'text' | 'title' | 'card' | 'row' | 'avatar'
  width?: string
  count?: number
}

export default function Skeleton({ variant = 'text', width, count = 1 }: SkeletonProps) {
  const items = Array.from({ length: count }, (_, i) => i)
  return (
    <>
      {items.map((i) => (
        <div
          key={i}
          className={`skeleton skeleton--${variant}`}
          style={width ? { width } : undefined}
        />
      ))}
    </>
  )
}
