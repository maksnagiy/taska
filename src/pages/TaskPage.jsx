import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import Layout from '../components/layout/Layout.jsx'
import { PriorityBadge, StatusBadge, Checkbox, AiBubble, formatDate, formatDue, formatDeadline } from '../components/ui/index.jsx'
import { getTask, getTasks, updateTask, deleteTask, addSubtask, toggleSubtask, deleteSubtask, replaceSubtasks, humanizeApiError } from '../store.js'
import { generateTaskDecomposition, generateTaskEncouragement, humanizeLlmError } from '../llmClient.js'

// ── 🔵 Fix #6: Кастомный модальный диалог вместо window.confirm ──────────────
function ConfirmModal({
  message,
  onConfirm,
  onCancel,
  confirmLabel = 'Удалить',
  confirmClassName = 'btn btn-danger btn-sm',
}) {
  return (
      <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
        <div className="card px-6 py-5 max-w-sm w-full mx-4 shadow-xl">
          <p className="text-sm text-gray-700 mb-4">{message}</p>
          <div className="flex gap-2 justify-end">
            <button onClick={onCancel} className="btn btn-secondary btn-sm">Отмена</button>
            <button onClick={onConfirm} className={confirmClassName}>{confirmLabel}</button>
          </div>
        </div>
      </div>
  )
}

export default function TaskPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const [task, setTask]               = useState(null)
  const [allTasks, setAllTasks]       = useState([])
  const [localSubtasks, setLocalSubtasks] = useState([])
  const [newSub, setNewSub]           = useState('')
  const [aiText, setAiText]           = useState('')
  const [aiMode, setAiMode]           = useState('')
  const [aiSubtasks, setAiSubtasks]   = useState([])
  const [aiApplying, setAiApplying]   = useState(false)
  const [aiLoading, setAiLoading]     = useState(false)
  const [errors, setErrors]           = useState([])       // 🟡 Fix #5: массив ошибок
  const [confirmOpen, setConfirmOpen] = useState(false)    // 🔵 Fix #6: состояние модалки
  const [aiReplaceConfirmOpen, setAiReplaceConfirmOpen] = useState(false)

  // ── 🔴 Fix #2: AbortController для отмены устаревших запросов ───────────────
  const abortRef = useRef(null)

  // Пока id подзадачи есть в этом сете — запрос летит, чекбокс заблокирован.
  // Повторный клик игнорируется. Это полностью исключает race condition.
  const [pendingToggles, setPendingToggles] = useState(new Set())

  // ── 🟡 Fix #5: хелперы для работы с массивом ошибок ─────────────────────────
  const pushError = useCallback((msg) => {
    setErrors(prev => [...prev, msg])
  }, [])

  const clearErrors = useCallback(() => setErrors([]), [])

  // ── 🔴 Fix #1: useCallback чтобы refresh была стабильной ссылкой ────────────
  //
  // syncSubtasks: true  → обновить localSubtasks из ответа сервера
  //               false → НЕ трогать localSubtasks (для toggle — чтобы не
  //                       вызывать второй ре-рендер и не «мигать» чекбоксом)
  const refresh = useCallback(async (signal, { syncSubtasks = false } = {}) => {
    try {
      const [taskData, tasksData] = await Promise.all([
        getTask(id, { signal }),
        getTasks({ signal }),
      ])
      if (signal?.aborted) return
      setTask(taskData)
      setAllTasks(tasksData)
      // Синхронизируем подзадачи только когда нам нужны реальные ID от сервера
      // (первая загрузка, добавление, удаление, применение AI-подзадач).
      // При toggle — пропускаем, чтобы не перезаписывать оптимистичный стейт.
      if (syncSubtasks) {
        setLocalSubtasks(taskData.subtasks ?? [])
      }
      clearErrors()
    } catch (err) {
      if (err.name === 'AbortError') return
      pushError(humanizeApiError(err, 'Не удалось загрузить задачу'))
    }
  }, [id, pushError, clearErrors])

  // ── 🔴 Fix #2: отменяем предыдущий запрос при смене id ──────────────────────
  useEffect(() => {
    abortRef.current?.abort()
    const controller = new AbortController()
    abortRef.current = controller

    setTask(null)
    setAllTasks([])
    setLocalSubtasks([])
    setPendingToggles(new Set())

    // ── 🟡 Fix #3: сбрасываем AI-состояние при смене задачи ─────────────────
    setAiText('')
    setAiMode('')
    setAiSubtasks([])
    setAiApplying(false)
    setAiReplaceConfirmOpen(false)
    clearErrors()

    // При первой загрузке синхронизируем подзадачи
    refresh(controller.signal, { syncSubtasks: true })

    return () => controller.abort()
  }, [id, refresh, clearErrors])

  // useEffect для синхронизации localSubtasks ← task УДАЛЁН.
  // Теперь localSubtasks — независимый стейт. Сервер обновляет его только
  // через явный { syncSubtasks: true } в refresh(), а не на каждый ре-рендер.

  if (!task) {
    return (
        <Layout title="Задача" back="/tasks">
          {errors.length > 0
              ? <ErrorList errors={errors} />
              : <div className="card px-4 py-3 text-sm text-gray-500">Загрузка...</div>
          }
        </Layout>
    )
  }

  // ── 🟡 Fix #4: отображаем deps корректно, даже если allTasks ещё грузится ───
  const deps = allTasks.length > 0
      ? (task.dependsOn?.map(i => allTasks.find(t => t.id === i)).filter(Boolean) ?? [])
      : null  // null = «ещё не известно»

  const due = task.dueDate ? formatDue(task.dueDate) : null

  function deriveTaskStatusFromSubtasks(subtasks) {
    if (!subtasks.length) return 'todo'

    const doneCount = subtasks.filter(subtask => subtask.done).length
    if (doneCount === subtasks.length) return 'done'
    if (doneCount > 0) return 'inprogress'
    return 'todo'
  }

  async function handleToggleSubtask(subtaskId) {
    // Если запрос уже летит — игнорируем клик. Никакой гонки запросов.
    if (pendingToggles.has(subtaskId)) return

    const previous = localSubtasks
    const previousTaskStatus = task.status
    const nextSubtasks = localSubtasks.map(subtask =>
      subtask.id === subtaskId ? { ...subtask, done: !subtask.done } : subtask
    )
    const toggledSubtask = nextSubtasks.find(subtask => subtask.id === subtaskId)
    const nextTaskStatus = deriveTaskStatusFromSubtasks(nextSubtasks)

    setLocalSubtasks(nextSubtasks)
    setTask(prev => prev ? { ...prev, status: nextTaskStatus } : prev)
    setPendingToggles(prev => new Set(prev).add(subtaskId))

    try {
      await toggleSubtask(id, subtaskId, {
        done: toggledSubtask?.done,
        nextStatus: nextTaskStatus,
      })
    } catch (err) {
      setLocalSubtasks(previous)
      setTask(prev => prev ? { ...prev, status: previousTaskStatus } : prev)
      pushError(humanizeApiError(err, 'Не удалось обновить подзадачу'))
    } finally {
      setPendingToggles(prev => { const s = new Set(prev); s.delete(subtaskId); return s })
    }
  }

  async function handleDeleteSubtask(subtaskId) {
    const previous = localSubtasks
    setLocalSubtasks(prev => prev.filter(s => s.id !== subtaskId))

    try {
      await deleteSubtask(id, subtaskId)
      // syncSubtasks: true — нужно получить актуальный список после удаления
      await refresh(undefined, { syncSubtasks: true })
    } catch (err) {
      setLocalSubtasks(previous)
      pushError(humanizeApiError(err, 'Не удалось удалить подзадачу'))
    }
  }

  // ── 🔵 Fix #6: удаление через кастомный диалог ──────────────────────────────
  async function handleDelete() {
    try {
      await deleteTask(id)
      navigate('/tasks')
    } catch (err) {
      pushError(humanizeApiError(err, 'Не удалось удалить задачу'))
    } finally {
      setConfirmOpen(false)
    }
  }

  async function handleStatusChange(e) {
    try {
      await updateTask(id, { status: e.target.value })
      await refresh()
    } catch (err) {
      pushError(humanizeApiError(err, 'Не удалось обновить статус'))
    }
  }

  async function handleAddSubtask(e) {
    e.preventDefault()
    if (!newSub.trim()) return

    // ── 🔵 Fix #8: оптимистичное добавление ─────────────────────────────────
    const optimistic = { id: `optimistic-${Date.now()}`, title: newSub.trim(), done: false }
    setLocalSubtasks(prev => [...prev, optimistic])
    setNewSub('')

    try {
      await addSubtask(id, optimistic.title)
      // syncSubtasks: true — заменяем оптимистичный id на реальный от сервера
      await refresh(undefined, { syncSubtasks: true })
    } catch (err) {
      setLocalSubtasks(prev => prev.filter(s => s.id !== optimistic.id))
      setNewSub(optimistic.title)
      pushError(humanizeApiError(err, 'Не удалось добавить подзадачу'))
    }
  }

  async function handleMotivate() {
    setAiLoading(true)
    setAiMode('motivate')
    setAiSubtasks([])
    setAiText('')
    try {
      const text = await generateTaskEncouragement({ task, tasks: allTasks })
      setAiText(text)
    } catch (err) {
      pushError(humanizeLlmError(err, 'Не удалось получить поддержку'))
    } finally {
      setAiLoading(false)
    }
  }

  async function runDecompose() {
    setAiLoading(true)
    setAiMode('decompose')
    setAiSubtasks([])
    setAiText('')

    try {
      const result = await generateTaskDecomposition({
        task: {
          id: task.id,
          title: task.title,
          description: task.description,
          status: task.status,
          priority: task.priority,
          dueDate: task.dueDate,
        },
        tasks: allTasks,
      })
      setAiText(result.text)
      setAiSubtasks(result.subtasks ?? [])
    } catch (err) {
      pushError(humanizeLlmError(err, 'Не удалось разложить задачу'))
    } finally {
      setAiLoading(false)
    }
  }

  function handleDecompose() {
    if (localSubtasks.length > 0) {
      setAiReplaceConfirmOpen(true)
      return
    }
    runDecompose()
  }

  async function handleApplyAiSubtasks() {
    if (aiSubtasks.length === 0) return

    const uniqueTitles = new Set()
    const nextSubtasks = aiSubtasks
      .map(title => title.trim())
      .filter((title) => {
        if (!title.length) return false
        const normalized = title.toLowerCase()
        if (uniqueTitles.has(normalized)) return false
        uniqueTitles.add(normalized)
        return true
      })
      .map(title => ({ title, done: false }))

    if (nextSubtasks.length === 0) {
      setAiSubtasks([])
      setAiText('')
      setAiMode('')
      return
    }

    setAiApplying(true)
    try {
      await replaceSubtasks(id, nextSubtasks)
      await refresh(undefined, { syncSubtasks: true })
      setAiSubtasks([])
      setAiText('')
      setAiMode('')
    } catch (err) {
      pushError(humanizeApiError(err, 'Не удалось добавить AI-подзадачи'))
    } finally {
      setAiApplying(false)
    }
  }

  return (
      <Layout title={task.title} back="/tasks" actions={
        <button onClick={() => navigate(`/tasks/${id}/edit`)} className="btn btn-secondary btn-sm">
          Редактировать
        </button>
      }>

        {/* 🔵 Fix #6: Кастомный диалог подтверждения */}
        {confirmOpen && (
            <ConfirmModal
                message="Удалить задачу? Это действие нельзя отменить."
                onConfirm={handleDelete}
                onCancel={() => setConfirmOpen(false)}
            />
        )}
        {aiReplaceConfirmOpen && (
          <ConfirmModal
            message="У вас уже есть подзадачи. Продолжить генерацию? При применении новые подзадачи сотрут текущие."
            onConfirm={() => {
              setAiReplaceConfirmOpen(false)
              runDecompose()
            }}
            onCancel={() => setAiReplaceConfirmOpen(false)}
            confirmLabel="Продолжить"
            confirmClassName="btn btn-primary btn-sm"
          />
        )}

        {/* 🟡 Fix #5: Список всех ошибок */}
        {errors.length > 0 && <ErrorList errors={errors} onDismiss={clearErrors} />}

        {/* Meta */}
        <div className="card px-4 py-4 mb-3">
          <div className="flex items-start justify-between gap-3 mb-3">
            <h2 className="font-semibold text-gray-900 leading-snug">{task.title}</h2>
          </div>

          <div className="flex flex-wrap gap-2 mb-3">
            <PriorityBadge priority={task.priority} />
            <StatusBadge status={task.status} />
            {due && <span className={`badge ${due.cls} bg-transparent px-0`}>📅 {due.label}</span>}
          </div>

          <div className="flex items-center gap-2">
            <span className="text-xs text-gray-400">Статус:</span>
            <select
                value={task.status}
                onChange={handleStatusChange}
                className="input py-1 text-xs w-auto"
            >
              <option value="todo">К выполнению</option>
              <option value="inprogress">В процессе</option>
              <option value="done">Выполнено</option>
            </select>
          </div>

          <div className="mt-3 space-y-1 text-xs text-gray-400 border-t border-gray-50 pt-3">
            <div>Создана: {formatDate(task.createdAt)}</div>
            {task.dueDate && <div>Срок: {formatDeadline(task.dueDate)}</div>}
            {/* 🟡 Fix #4: показываем deps только когда allTasks загружен */}
            {deps === null && task.dependsOn?.length > 0 && (
                <div className="text-gray-300">Зависимости загружаются...</div>
            )}
            {deps !== null && deps.length > 0 && (
                <div>Зависит от: {deps.map(d => d.title).join(', ')}</div>
            )}
          </div>
        </div>

        {/* Description */}
        {task.description && (
            <div className="card px-4 py-3.5 mb-3">
              <p className="text-xs text-gray-400 mb-1.5 font-medium uppercase tracking-wide">Описание</p>
              <p className="text-sm text-gray-700 leading-relaxed">{task.description}</p>
            </div>
        )}

        {/* Subtasks */}
        <div className="card px-4 py-3.5 mb-3">
          <div className="flex items-center justify-between mb-3">
            <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">
              Подзадачи
              {localSubtasks.length > 0 && (
                  <span className="ml-1 text-accent">
                {localSubtasks.filter(s => s.done).length}/{localSubtasks.length}
              </span>
              )}
            </p>
          </div>

          {localSubtasks.length > 0 && (
              <>
                <div className="h-1 bg-gray-100 rounded-full overflow-hidden mb-3">
                  <div
                      className="h-full bg-accent rounded-full transition-all"
                      style={{ width: `${(localSubtasks.filter(s => s.done).length / localSubtasks.length) * 100}%` }}
                  />
                </div>
                <ul className="space-y-1.5 mb-3">
                  {localSubtasks.map(s => (
                      <li key={s.id} className="flex items-center gap-2.5 group">
                        <Checkbox
                            checked={s.done}
                            onChange={() => handleToggleSubtask(s.id)}
                            disabled={pendingToggles.has(s.id)}
                            size={16}
                        />
                        <span className={`flex-1 text-sm ${s.done ? 'line-through text-gray-400' : 'text-gray-700'}`}>
                    {s.title}
                  </span>
                        {/* 🔵 Fix #7: именованный обработчик */}
                        <button
                            type="button"
                            onClick={() => handleDeleteSubtask(s.id)}
                            aria-label="Удалить подзадачу"
                            className="w-6 h-6 rounded-md border border-red-200 bg-red-50 text-red-600 hover:bg-red-100 hover:text-red-700 text-sm font-semibold flex items-center justify-center cursor-pointer"
                        >
                          ✕
                        </button>
                      </li>
                  ))}
                </ul>
              </>
          )}

          {/* 🔵 Fix #8: оптимистичное добавление — инпут не блокируется */}
          <form onSubmit={handleAddSubtask} className="flex gap-2">
            <input
                className="input flex-1 py-1.5 text-xs"
                placeholder="Добавить подзадачу..."
                value={newSub}
                onChange={e => setNewSub(e.target.value)}
            />
            <button type="submit" className="btn btn-secondary btn-sm">+</button>
          </form>
        </div>

        {/* AI tools */}
        <div className="card px-4 py-3.5 mb-3">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-3">ИИ-помощник</p>
          <div className="flex flex-wrap gap-2">
            <button onClick={handleDecompose} disabled={aiLoading} className="btn btn-secondary btn-sm">
              ✦ Разбить на подзадачи
            </button>
            <button onClick={handleMotivate} disabled={aiLoading} className="btn btn-secondary btn-sm">
              ✦ Моральная поддержка
            </button>
          </div>

          {(aiLoading || aiText) && (
              <AiBubble loading={aiLoading}>{aiText}</AiBubble>
          )}

          {!aiLoading && aiMode === 'decompose' && aiSubtasks.length > 0 && (
            <button
              type="button"
              onClick={handleApplyAiSubtasks}
              disabled={aiApplying}
              className="btn btn-secondary btn-sm mt-2"
            >
              {aiApplying ? 'Применяю...' : 'Применить как подзадачи'}
            </button>
          )}
        </div>

        {/* Delete — 🔵 Fix #6: открываем модалку вместо window.confirm */}
        <button onClick={() => setConfirmOpen(true)} className="btn btn-danger w-full justify-center">
          Удалить задачу
        </button>
      </Layout>
  )
}

// ── Вспомогательный компонент для списка ошибок ──────────────────────────────
function ErrorList({ errors, onDismiss }) {
  return (
      <div className="card px-3 py-2 mb-3 text-xs text-red-500 space-y-1">
        {errors.map((msg, i) => <div key={i}>{msg}</div>)}
        {onDismiss && (
            <button onClick={onDismiss} className="text-gray-400 hover:text-gray-600 mt-1 underline bg-transparent border-0 cursor-pointer">
              Скрыть
            </button>
        )}
      </div>
  )
}
