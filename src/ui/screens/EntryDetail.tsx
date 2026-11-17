import { useState } from 'react'
import { Icon } from '../components/Icon'
import { ConfirmSheet, KindBadge, useLoad } from '../components/controls'
import { api } from '../lib/client'
import { longDate } from '../lib/dates'
import { INITIATORS, PROTECTIONS, kindInfo, labelOf } from '../lib/entries'

/** Entry details (screen 5): every field, with Edit and Delete. */
export function EntryDetail({ id, version, onBack, onEdit, onDeleted }: { id: string; version: number; onBack: () => void; onEdit: () => void; onDeleted: () => void }) {
  const { data: event, error } = useLoad(() => api('events.get', id), [id, version])
  const [confirming, setConfirming] = useState(false)

  const remove = async () => {
    await api('events.delete', id)
    onDeleted()
  }

  if (error) {
    return (
      <div className="page">
        <button type="button" className="back" onClick={onBack}>
          <Icon name="back" size={20} strokeWidth={2} /> Back
        </button>
        <p className="error-text">{error}</p>
      </div>
    )
  }
  if (!event) return <div className="page" />

  const info = kindInfo(event.kind)
  const rated = event.kind === 'sex' || event.kind === 'masturbation'
  const fields: Array<[string, string, string?]> = []
  if (event.kind === 'sex') fields.push(['Partner', event.partnerLabel ?? '—', event.partnerLabel ? 'terracotta-text' : undefined])
  if (rated) {
    fields.push(['Satisfaction', event.satisfaction === null ? '—' : `${event.satisfaction} / 10`])
    fields.push(['Orgasm', event.orgasm === null ? '—' : event.orgasm ? 'Yes' : 'No'])
  }
  if (event.kind === 'sex') {
    fields.push(['Initiated by', labelOf(INITIATORS, event.initiator) ?? '—'])
    fields.push(['Protection', labelOf(PROTECTIONS, event.protection) ?? '—'])
  }

  return (
    <div className="page">
      <button type="button" className="back" onClick={onBack}>
        <Icon name="back" size={20} strokeWidth={2} /> Back
      </button>
      <div className="detail-head">
        <KindBadge icon={info.icon} tone={info.partnered ? 'terracotta' : 'teal'} size={52} />
        <div>
          <h1>{info.label}</h1>
          <p className="muted">
            {longDate(event.occurredOn)}
            {event.occurredTime ? ` · ${event.occurredTime}` : ''}
          </p>
        </div>
      </div>
      {fields.length > 0 && (
        <div className="card list-card">
          {fields.map(([name, value, tone]) => (
            <div key={name} className="field-line">
              <span className="muted">{name}</span>
              <b className={tone}>{value}</b>
            </div>
          ))}
        </div>
      )}
      <div className="card">
        <p className="muted small">Note</p>
        <p className="note-text">{event.note ?? 'No note'}</p>
      </div>
      <div className="button-pair push-bottom">
        <button type="button" className="button primary grow2" onClick={onEdit}>
          Edit
        </button>
        <button type="button" className="button secondary danger-text" onClick={() => setConfirming(true)}>
          Delete
        </button>
      </div>
      {confirming && (
        <ConfirmSheet
          title="Delete this entry?"
          message="It is removed from this phone for good."
          confirm="Delete entry"
          onConfirm={() => void remove()}
          onCancel={() => setConfirming(false)}
        />
      )}
    </div>
  )
}
