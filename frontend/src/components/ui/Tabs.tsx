interface Tab {
  key: string
  label: string
  badge?: number
}

interface TabsProps {
  tabs: Tab[]
  activeTab: string
  onTabChange: (key: string) => void
}

export default function Tabs({ tabs, activeTab, onTabChange }: TabsProps) {
  return (
    <div className="tab-bar">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          className={`tab-btn ${activeTab === tab.key ? 'tab-btn--active active' : ''}`}
          onClick={() => onTabChange(tab.key)}
        >
          {tab.label}
          {tab.badge != null && tab.badge > 0 && (
            <span className="tab-btn__badge">{tab.badge}</span>
          )}
        </button>
      ))}
    </div>
  )
}
