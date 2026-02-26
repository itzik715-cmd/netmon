declare module 'react-grid-layout' {
  import { ComponentType, Ref } from 'react'

  export interface LayoutItem {
    i: string
    x: number
    y: number
    w: number
    h: number
    minW?: number
    minH?: number
    maxW?: number
    maxH?: number
    static?: boolean
  }

  export type Layouts = Record<string, LayoutItem[]>

  export interface ResponsiveGridLayoutProps {
    width: number
    layouts?: Layouts
    breakpoints?: Record<string, number>
    cols?: Record<string, number>
    rowHeight?: number
    margin?: [number, number]
    containerPadding?: [number, number]
    draggableHandle?: string
    resizeHandles?: string[]
    compactType?: 'vertical' | 'horizontal' | null
    onLayoutChange?: (currentLayout: LayoutItem[], allLayouts: Layouts) => void
    onBreakpointChange?: (newBreakpoint: string, newCols: number) => void
    children?: React.ReactNode
    className?: string
    [key: string]: any
  }

  export const ResponsiveGridLayout: ComponentType<ResponsiveGridLayoutProps>
  export const Responsive: ComponentType<ResponsiveGridLayoutProps>

  export function useContainerWidth(options?: {
    measureBeforeMount?: boolean
    initialWidth?: number
  }): {
    containerRef: Ref<any>
    width: number
  }
}

declare module 'react-grid-layout/css/styles.css' {
  const content: string
  export default content
}

declare module 'react-resizable/css/styles.css' {
  const content: string
  export default content
}
