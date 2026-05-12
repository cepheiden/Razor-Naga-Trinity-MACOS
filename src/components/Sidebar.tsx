import { Languages, MousePointer2, Plus, Radar, RefreshCw } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SUPPORTED_LANGUAGES, type SupportedLanguage } from '../i18n'
import { useActiveProfile, useNagaStore } from '../store/useNagaStore'

export function Sidebar() {
  const { t, i18n } = useTranslation()
  const device = useNagaStore((state) => state.device)
  const store = useNagaStore((state) => state.store)
  const active = useActiveProfile()
  const selectProfile = useNagaStore((state) => state.selectProfile)
  const createProfile = useNagaStore((state) => state.createProfile)
  const rescan = useNagaStore((state) => state.rescan)

  const activeStage = active.dpi.stages[active.dpi.activeStage - 1] ?? active.dpi.stages[0]
  const currentLang = (i18n.resolvedLanguage ?? i18n.language ?? 'de').slice(0, 2) as SupportedLanguage

  const switchLanguage = (code: SupportedLanguage) => {
    void i18n.changeLanguage(code)
    void window.naga?.updateSettings?.({ language: code })
  }

  return (
    <aside className="sidebar">
      <div className="brand">
        <div className="brand-mark">
          <MousePointer2 size={20} />
        </div>
        <div className="brand-text">
          <span>Naga Trinity</span>
          <strong>{t('sidebar.brandSub')}</strong>
        </div>
      </div>

      <div className="device-card">
        <div className={`device-orbit ${device.connected ? 'live' : ''}`}>
          <Radar size={28} />
        </div>
        <div className="device-meta">
          <span className={`pill ${device.connected ? 'good' : 'warn'}`}>
            <span className="pill-dot" />
            {device.connected ? t('common.connected') : t('common.disconnected')}
          </span>
          <h2>{device.productName || 'Razer Naga Trinity'}</h2>
          <p>
            VID:PID <strong>1532:0067</strong>
            <span className="dot-sep">·</span>
            {device.interfaces || 0} {t('sidebar.hidInterfaces')}
          </p>
        </div>
        <button
          className="ghost-button compact full-width"
          type="button"
          onClick={() => void rescan()}
        >
          <RefreshCw size={14} />
          {t('sidebar.rescan')}
        </button>
      </div>

      <div className="profile-section">
        <header>
          <span>{t('sidebar.profiles')}</span>
          <button
            type="button"
            className="icon-button small"
            onClick={() => void createProfile()}
            aria-label={t('sidebar.addProfile')}
          >
            <Plus size={14} />
          </button>
        </header>

        <nav className="profile-list" aria-label={t('sidebar.profiles')}>
          {store.profiles.map((item) => (
            <button
              className={`profile ${item.id === active.id ? 'active' : ''}`}
              key={item.id}
              type="button"
              onClick={() => void selectProfile(item.id)}
            >
              <div className="profile-info">
                <span>{item.name}</span>
                <small>
                  {item.dpi.stages[item.dpi.activeStage - 1]?.x ?? 1800} {t('sidebar.dpiSuffix')}
                  <span className="dot-sep">·</span>
                  {item.pollingRate}Hz
                </small>
              </div>
              <div
                className="profile-swatch"
                style={{ background: item.rgb.color }}
                aria-hidden
              />
            </button>
          ))}
        </nav>
      </div>

      <footer className="sidebar-footer">
        <div className="footer-stage">
          <span>{t('sidebar.activeStage')}</span>
          <strong>{activeStage?.x ?? 1800} {t('sidebar.dpiSuffix')}</strong>
        </div>
        <div className="lang-switch" role="group" aria-label={t('topbar.language')}>
          <Languages size={13} />
          {SUPPORTED_LANGUAGES.map((code) => (
            <button
              key={code}
              type="button"
              className={`lang-button ${currentLang === code ? 'active' : ''}`}
              onClick={() => switchLanguage(code)}
              aria-pressed={currentLang === code}
            >
              {code.toUpperCase()}
            </button>
          ))}
        </div>
        <p className="trademark-note">
          <span>{t('trademark.short')}</span>
          <span>{t('trademark.disclaimer')}</span>
        </p>
      </footer>
    </aside>
  )
}
