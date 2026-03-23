import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../components/layout/Layout.jsx'
import { AiBubble, Checkbox } from '../components/ui/index.jsx'
import { getTask, getTasks, createTask, updateTask, replaceSubtasks, humanizeApiError } from '../store.js'
import { generateTaskDescription, generateTaskDecomposition, humanizeLlmError } from '../llmClient.js'

const EMPTY = {
  title: '',
  description: '',
  status: 'todo',
  priority: 'med',
  dueDate: '',
  subtasks: [],
}

function getTodayDatePart() {
  const now = new Date()
  const local = new Date(now.getTime() - now.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 10)
}

function createDraftSubtask(title) {
  return {
    id: `draft-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    title: title.trim(),
    done: false,
  }
}

function extractDueDatePart(value) {
  if (!value) return ''
  const stringValue = String(value)
  const matchedDate = stringValue.match(/^(\d{4}-\d{2}-\d{2})/)
  return matchedDate?.[1] ?? ''
}

/*
  Временная часть дедлайна отключена по запросу:
  оставляем только дату (YYYY-MM-DD).
*/

export default function TaskFormPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const isEdit = Boolean(id)
  const descriptionRef = useRef(null)

  const [form, setForm] = useState(() => ({
    ...EMPTY,
    dueDate: getTodayDatePart(),
  }))
  const [allTasks, setAllTasks] = useState([])
  const [newSubtask, setNewSubtask] = useState('')
  const [aiLoading, setAiLoading] = useState(false)
  const [aiText, setAiText] = useState('')
  const [aiMode, setAiMode] = useState('')
  const [aiSubtasks, setAiSubtasks] = useState([])
  const [aiApplying, setAiApplying] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let cancelled = false

    async function load() {
      try {
        const tasks = await getTasks()
        if (!cancelled) setAllTasks(tasks.filter(task => task.id !== id))

        if (!isEdit) {
          if (!cancelled) {
            setForm({
              ...EMPTY,
              dueDate: getTodayDatePart(),
            })
          }
          return
        }

        const task = await getTask(id)
        if (!cancelled && task) {
          setForm({
            ...EMPTY,
            ...task,
            dueDate: extractDueDatePart(task.dueDate ?? ''),
            subtasks: (task.subtasks ?? []).map(subtask => ({
              id: String(subtask.id),
              title: subtask.title,
              done: Boolean(subtask.done),
            })),
          })
        }
      } catch (err) {
        if (!cancelled) setError(humanizeApiError(err, 'Не удалось загрузить форму'))
      }
    }

    load()
    return () => { cancelled = true }
  }, [id, isEdit])

  function set(key, val) {
    setForm(prev => ({ ...prev, [key]: val }))
  }

  function resizeDescription(element) {
    if (!element) return
    element.style.height = '0px'
    element.style.height = `${element.scrollHeight}px`
  }

  useEffect(() => {
    resizeDescription(descriptionRef.current)
  }, [form.description])

  function setDueDatePart(datePart) {
    setForm(prev => ({ ...prev, dueDate: datePart }))
  }

  function handleAddDraftSubtask() {
    const title = newSubtask.trim()
    if (!title) return

    setForm(prev => ({
      ...prev,
      subtasks: [...prev.subtasks, createDraftSubtask(title)],
    }))
    setNewSubtask('')
  }

  function handleToggleDraftSubtask(subtaskId) {
    setForm(prev => ({
      ...prev,
      subtasks: prev.subtasks.map(subtask => (
        subtask.id === subtaskId ? { ...subtask, done: !subtask.done } : subtask
      )),
    }))
  }

  function handleDeleteDraftSubtask(subtaskId) {
    setForm(prev => ({
      ...prev,
      subtasks: prev.subtasks.filter(subtask => subtask.id !== subtaskId),
    }))
  }

  async function handleAiDesc() {
    if (!form.title.trim()) { setError('Введите название задачи'); return }

    setAiLoading(true)
    setAiMode('description')
    setAiText('')
    setAiSubtasks([])
    setError('')

    try {
      const text = await generateTaskDescription({ title: form.title, tasks: allTasks })
      setAiText(text)
    } catch (err) {
      setError(humanizeLlmError(err, 'Не удалось сгенерировать описание'))
    } finally {
      setAiLoading(false)
    }
  }

  async function handleAiDecompose() {
    if (!form.title.trim()) { setError('Введите название задачи'); return }

    setAiLoading(true)
    setAiMode('subtasks')
    setAiText('')
    setAiSubtasks([])
    setError('')

    try {
      const result = await generateTaskDecomposition({
        task: {
          id: id ?? 'new',
          title: form.title,
          description: form.description,
          status: form.status,
          priority: form.priority,
          dueDate: form.dueDate,
        },
        tasks: allTasks,
      })
      setAiText(result.text)
      setAiSubtasks(result.subtasks ?? [])
    } catch (err) {
      setError(humanizeLlmError(err, 'Не удалось разложить задачу'))
    } finally {
      setAiLoading(false)
    }
  }

  function applyAiDesc() {
    set('description', aiText)
    setAiText('')
    setAiMode('')
  }

  function applyAiSubtasks() {
    if (aiSubtasks.length === 0) return

    setAiApplying(true)
    setForm(prev => {
      const existingTitles = new Set(prev.subtasks.map(subtask => subtask.title.trim().toLowerCase()))
      const generated = aiSubtasks
        .map(title => title.trim())
        .filter(title => title && !existingTitles.has(title.toLowerCase()))
        .map(title => createDraftSubtask(title))

      return {
        ...prev,
        subtasks: [...prev.subtasks, ...generated],
      }
    })

    setAiApplying(false)
    setAiSubtasks([])
    setAiText('')
    setAiMode('')
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.title.trim()) { setError('Введите название задачи'); return }

    setError('')

    const { subtasks, ...taskFields } = form
    const normalizedSubtasks = subtasks
      .map(subtask => ({
        id: subtask.id,
        title: subtask.title.trim(),
        done: Boolean(subtask.done),
      }))
      .filter(subtask => subtask.title.length > 0)

    const taskPayload = {
      ...taskFields,
      dueDate: extractDueDatePart(form.dueDate) || null,
      dependsOn: [],
    }

    try {
      if (isEdit) {
        await updateTask(id, taskPayload)
        await replaceSubtasks(id, normalizedSubtasks)
        navigate(`/tasks/${id}`)
      } else {
        const task = await createTask(taskPayload)
        await replaceSubtasks(task.id, normalizedSubtasks)
        navigate(`/tasks/${task.id}`)
      }
    } catch (err) {
      setError(humanizeApiError(err, 'Не удалось сохранить задачу'))
    }
  }

  return (
    <Layout title={isEdit ? 'Редактировать задачу' : 'Новая задача'} back={isEdit ? `/tasks/${id}` : '/tasks'}>
      <form onSubmit={handleSubmit} className="space-y-4">

        <div className="card px-4 py-4 space-y-4">
          <div>
            <label className="block text-xs text-gray-500 mb-1.5">Название *</label>
            <input
              className="input"
              placeholder="Что нужно сделать?"
              value={form.title}
              onChange={e => { set('title', e.target.value); setError('') }}
              autoFocus
            />
            {error && <p className="text-xs text-red-500 mt-1">{error}</p>}
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="text-xs text-gray-500">Описание</label>
              <button
                type="button"
                onClick={handleAiDesc}
                disabled={aiLoading}
                className="text-xs text-accent hover:text-accent-hover flex items-center gap-1 bg-transparent border-0 cursor-pointer p-0"
              >
                ✦ Сгенерировать
              </button>
            </div>
            <textarea
              ref={descriptionRef}
              className="input resize-none overflow-hidden"
              rows={3}
              placeholder="Детали задачи..."
              value={form.description}
              onChange={e => set('description', e.target.value)}
              onInput={e => resizeDescription(e.currentTarget)}
            />
            {aiMode === 'description' && (aiLoading || aiText) && (
              <div className="mt-2">
                <AiBubble loading={aiLoading}>{aiText}</AiBubble>
                {aiText && (
                  <button
                    type="button"
                    onClick={applyAiDesc}
                    className="btn btn-secondary btn-sm mt-2"
                  >
                    Вставить в описание
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        <div className="card px-4 py-4">
          <div className="flex items-center justify-between mb-2.5">
            <label className="text-xs text-gray-500">Подзадачи</label>
            <button
              type="button"
              onClick={handleAiDecompose}
              disabled={aiLoading}
              className="text-xs text-accent hover:text-accent-hover flex items-center gap-1 bg-transparent border-0 cursor-pointer p-0"
            >
              ✦ Разбить на подзадачи
            </button>
          </div>

          {form.subtasks.length > 0 && (
            <ul className="space-y-1.5 mb-3">
              {form.subtasks.map(subtask => (
                <li key={subtask.id} className="flex items-center gap-2.5 group">
                  <Checkbox
                    checked={subtask.done}
                    size={16}
                    onChange={() => { handleToggleDraftSubtask(subtask.id) }}
                  />
                  <span className={`flex-1 text-sm ${subtask.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                    {subtask.title}
                  </span>
                  <button
                    type="button"
                    onClick={() => { handleDeleteDraftSubtask(subtask.id) }}
                    aria-label="Удалить подзадачу"
                    className="w-6 h-6 rounded-md border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 text-sm font-semibold flex items-center justify-center cursor-pointer"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="flex gap-2">
            <input
              className="input flex-1 py-1.5 text-xs"
              placeholder="Добавить подзадачу..."
              value={newSubtask}
              onChange={e => setNewSubtask(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  handleAddDraftSubtask()
                }
              }}
            />
            <button type="button" onClick={handleAddDraftSubtask} className="btn btn-secondary btn-sm">+</button>
          </div>

          {aiMode === 'subtasks' && (aiLoading || aiText) && (
            <div className="mt-2">
              <AiBubble loading={aiLoading}>{aiText}</AiBubble>
              {!aiLoading && aiSubtasks.length > 0 && (
                <button
                  type="button"
                  onClick={applyAiSubtasks}
                  disabled={aiApplying}
                  className="btn btn-secondary btn-sm mt-2"
                >
                  {aiApplying ? 'Применяю...' : 'Применить как подзадачи'}
                </button>
              )}
            </div>
          )}
        </div>

        <div className="card px-4 py-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Приоритет</label>
              <div className="relative">
                <select
                  className="input appearance-none pr-9"
                  value={form.priority}
                  onChange={e => set('priority', e.target.value)}
                >
                  <option value="high">Высокий</option>
                  <option value="med">Средний</option>
                  <option value="low">Низкий</option>
                </select>
                <svg
                  className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                  width="14"
                  height="14"
                  viewBox="0 0 20 20"
                  fill="none"
                  aria-hidden="true"
                >
                  <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
            </div>
            {isEdit && (
              <div>
                <label className="block text-xs text-gray-500 mb-1.5">Статус</label>
                <div className="relative">
                  <select className="input appearance-none pr-9" value={form.status} onChange={e => set('status', e.target.value)}>
                    <option value="todo">К выполнению</option>
                    <option value="inprogress">В процессе</option>
                    <option value="done">Выполнено</option>
                  </select>
                  <svg
                    className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-gray-400"
                    width="14"
                    height="14"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              </div>
            )}
            <div>
              <label className="block text-xs text-gray-500 mb-1.5">Срок выполнения</label>
              <input
                className="input text-gray-900"
                type="date"
                value={extractDueDatePart(form.dueDate)}
                onChange={e => setDueDatePart(e.target.value)}
              />
              {/*
                Поле времени дедлайна отключено.
                Если вернёмся к времени — вернём второй инпут HH:MM.
              */}
            </div>
          </div>
        </div>

        <div className="flex gap-2.5">
          <button type="submit" className="btn btn-primary flex-1 justify-center py-2.5">
            {isEdit ? 'Сохранить' : 'Создать задачу'}
          </button>
          <button
            type="button"
            onClick={() => navigate(isEdit ? `/tasks/${id}` : '/tasks')}
            className="btn btn-secondary"
          >
            Отмена
          </button>
        </div>

      </form>
    </Layout>
  )
}
