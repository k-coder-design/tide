import type { ApiHandlers } from '../shared/api'
import type { Context } from './domain/context'
import { BackupService } from './domain/backups'
import { CheckinService } from './domain/checkins'
import { CycleService } from './domain/cycle'
import { EventService } from './domain/events'
import { InsightsService } from './domain/insights'
import { JournalService } from './domain/journal'
import { MedicationService } from './domain/medications'
import { PartnerService } from './domain/partners'
import { PillService } from './domain/pills'
import { SettingsService } from './domain/settings'

/** The core's API: each method is a call into the domain layer. */
export function createHandlers(ctx: Context): ApiHandlers {
  const events = new EventService(ctx)
  const checkins = new CheckinService(ctx)
  const journal = new JournalService(ctx)
  const partners = new PartnerService(ctx)
  const settings = new SettingsService(ctx)
  const backups = new BackupService(ctx)
  const insights = new InsightsService(ctx)
  const cycle = new CycleService(ctx)
  const medications = new MedicationService(ctx)
  const pills = new PillService(ctx)
  return {
    'today.summary': (today) => ({ desire: checkins.desire(today), week: journal.week(today) }),
    'checkins.setDesire': (date, desire) => checkins.setDesire(date, desire),
    'events.get': (id) => events.get(id),
    'events.create': (input) => events.create(input),
    'events.update': (id, input) => events.update(id, input),
    'events.delete': (id) => events.delete(id),
    'journal.days': (query) => journal.days(query),
    'journal.day': (date) => journal.day(date),
    'journal.month': (month) => journal.month(month),
    'partners.list': (includeArchived) => partners.list(includeArchived),
    'partners.create': (label) => partners.create(label),
    'partners.rename': (id, label) => partners.rename(id, label),
    'partners.setArchived': (id, archived) => partners.setArchived(id, archived),
    'settings.get': () => settings.get(),
    'settings.setTheme': (theme) => settings.setTheme(theme),
    'insights.libido': (today, period) => insights.libido(today, period),
    'backup.status': () => backups.status(),
    'backup.markDone': () => backups.markDone(),
    'backup.setReminder': (on) => backups.setReminder(on),
    'backup.setPlain': (on) => backups.setPlain(on),
    'cycle.day': (date) => cycle.day(date),
    'cycle.setFlow': (date, flow) => cycle.setFlow(date, flow),
    'cycle.setSymptoms': (date, tags) => cycle.setSymptoms(date, tags),
    'insights.cycle': (today) => cycle.insights(today),
    'medications.list': (today) => medications.list(today),
    'medications.create': (input, today) => medications.create(input, today),
    'medications.update': (id, input, today) => medications.update(id, input, today),
    'medications.delete': (id) => medications.delete(id),
    'pills.today': (zone) => pills.today(zone),
    'pills.log': (medicationId, zone) => pills.log(medicationId, zone),
    'pills.take': (input) => pills.take(input),
    'pills.miss': (input) => pills.miss(input),
    'pills.delete': (id) => pills.delete(id)
  }
}
