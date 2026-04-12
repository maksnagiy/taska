// ── Priority ──────────────────────────────────────────────
export const PRIORITY_META = {
  high: { label: 'Высокий', color: 'text-red-600 bg-red-50',   dot: 'bg-red-500' },
  med:  { label: 'Средний', color: 'text-amber-600 bg-amber-50', dot: 'bg-amber-400' },
  low:  { label: 'Низкий',  color: 'text-green-600 bg-green-50', dot: 'bg-green-500' },
}

export const STATUS_META = {
  todo:       { label: 'К выполнению', color: 'text-gray-600 bg-gray-100' },
  inprogress: { label: 'В процессе',   color: 'text-blue-600 bg-blue-50' },
  done:       { label: 'Выполнено',    color: 'text-green-600 bg-green-50' },
}

export function PriorityBadge({ priority }) {
  const m = PRIORITY_META[priority] ?? PRIORITY_META.low
  return <span className={`badge ${m.color}`}>{m.label}</span>
}

export function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? STATUS_META.todo
  return <span className={`badge ${m.color}`}>{m.label}</span>
}

// ── Checkbox ──────────────────────────────────────────────
export function Checkbox({ checked, onChange, disabled = false, size = 18 }) {
  return (
    <button
      type="button"
      onClick={onChange}
      disabled={disabled}
      style={{ width: size, height: size }}
      className={`rounded-full border-2 flex items-center justify-center flex-shrink-0 transition-all
        ${disabled ? 'cursor-not-allowed opacity-70' : 'cursor-pointer'}
        ${checked ? 'bg-accent border-accent' : 'border-gray-300 bg-white'}
        ${!checked && !disabled ? 'hover:border-accent' : ''}`}
    >
      {checked && (
        <svg viewBox="0 0 10 8" width="10" height="8" fill="none">
          <path d="M1 4l3 3 5-5" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
      )}
    </button>
  )
}

// ── Spinner ───────────────────────────────────────────────
export function Spinner() {
  return (
    <div className="w-5 h-5 border-2 border-accent/30 border-t-accent rounded-full animate-spin" />
  )
}

// ── Empty state ───────────────────────────────────────────
export function Empty({ text = 'Задач нет' }) {
  return (
    <div className="text-center py-16 text-gray-400">
      <div className="text-4xl mb-3">✓</div>
      <p className="text-sm">{text}</p>
    </div>
  )
}

// ── AI bubble ─────────────────────────────────────────────
export function AiBubble({ children, loading }) {
  return (
    <div className="flex gap-2.5 mt-3">
      <div className="w-6 h-6 rounded-full bg-accent flex items-center justify-center flex-shrink-0 mt-0.5">
        <span className="text-white text-[10px] font-bold">AI</span>
      </div>
      <div className="flex-1 bg-accent-light rounded-xl rounded-tl-sm px-3.5 py-2.5 text-sm text-gray-700 leading-relaxed">
        {loading ? <span className="text-accent text-xs">Генерирую...</span> : children}
      </div>
    </div>
  )
}

// ── Format date ───────────────────────────────────────────
export function formatDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
}

function parseDueValue(dueValue) {
  if (!dueValue) return null

  const stringValue = String(dueValue).trim()
  if (!stringValue) return null

  const hasTime = /T\d{2}:\d{2}/.test(stringValue)
  const date = new Date(stringValue)
  if (!Number.isNaN(date.getTime())) {
    return { date, hasTime }
  }

  const dayPart = stringValue.slice(0, 10)
  if (/^\d{4}-\d{2}-\d{2}$/.test(dayPart)) {
    const fallbackDate = new Date(`${dayPart}T00:00:00`)
    if (!Number.isNaN(fallbackDate.getTime())) {
      return { date: fallbackDate, hasTime: false }
    }
  }

  return null
}

function formatTime(date) {
  return date.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' })
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate())
}

export function formatDue(dateStr) {
  const parsed = parseDueValue(dateStr)
  if (!parsed) return ''

  const now = new Date()
  const dueDate = parsed.date
  const dayDiff = Math.round((startOfDay(dueDate) - startOfDay(now)) / 86400000)
  const overdueByTime = parsed.hasTime && dayDiff === 0 && dueDate.getTime() < now.getTime()

  if (dayDiff < 0 || overdueByTime) {
    return { label: 'Просрочено', cls: 'text-red-500' }
  }

  if (dayDiff === 0) {
    return {
      label: parsed.hasTime ? `Сегодня, ${formatTime(dueDate)}` : 'Сегодня',
      cls: 'text-amber-500',
    }
  }

  if (dayDiff === 1) {
    return {
      label: parsed.hasTime ? `Завтра, ${formatTime(dueDate)}` : 'Завтра',
      cls: 'text-blue-500',
    }
  }

  const dateLabel = dueDate.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short' })
  const label = parsed.hasTime ? `${dateLabel}, ${formatTime(dueDate)}` : dateLabel
  return { label, cls: 'text-gray-400' }
}

export function formatDeadline(dateStr) {
  const parsed = parseDueValue(dateStr)
  if (!parsed) return String(dateStr ?? '')

  const datePart = parsed.date.toLocaleDateString('ru-RU', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })

  if (!parsed.hasTime) return datePart
  return `${datePart} ${formatTime(parsed.date)}`
}
