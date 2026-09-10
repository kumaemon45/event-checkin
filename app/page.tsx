'use client'

import { useEffect, useState, useRef } from 'react'
import { supabase } from '@/lib/supabase'

type Event = {
  id: string
  name: string
  event_date: string
}

type Attendee = {
  id: string
  event_id: string
  name: string
  furigana: string | null
  email: string | null
  checked_in: boolean
  checked_in_at: string | null
  type: 'adult' | 'child'
  is_reception: boolean
  reception_updated_at: string | null
}

export default function CheckInPage() {
  const [event, setEvent] = useState<Event | null>(null)
  const [attendees, setAttendees] = useState<Attendee[]>([])
  const [search, setSearch] = useState('')
  const [loading, setLoading] = useState(true)
  const [newName, setNewName] = useState('')
  const [newFurigana, setNewFurigana] = useState('')
  const [showAddForm, setShowAddForm] = useState(false)
  const [checking, setChecking] = useState<string | null>(null)
  const [importing, setImporting] = useState(false)
  const [isAdultOpen, setIsAdultOpen] = useState(true)
  const [isChildOpen, setIsChildOpen] = useState(true)
  const [confirmingId, setConfirmingId] = useState<string | null>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const confirmTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { fetchData() }, [])

  useEffect(() => {
    if (!event) return
    const channel = supabase
      .channel('event_attendees_changes')
      .on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'event_attendees' },
        (payload) => {
          setAttendees(prev => prev.map(a => a.id === payload.new.id ? { ...a, ...payload.new } as Attendee : a))
        }
      )
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'event_attendees' },
        (payload) => {
          setAttendees(prev => {
            if (prev.some(a => a.id === payload.new.id)) return prev
            return [...prev, payload.new as Attendee]
          })
        }
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [event])

  useEffect(() => {
    return () => {
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    }
  }, [])

  const fetchData = async () => {
    const { data: eventData } = await supabase
      .from('events').select('*')
      .order('event_date', { ascending: false }).limit(1).single()
    if (eventData) {
      setEvent(eventData)
      const { data: attendeesData } = await supabase
        .from('event_attendees').select('*')
        .eq('event_id', eventData.id).order('name')
      setAttendees(attendeesData || [])
    }
    setLoading(false)
  }

  const handleCardTap = async (attendee: Attendee) => {
    if (attendee.checked_in) {
      setConfirmingId(attendee.id)
      if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
      confirmTimeoutRef.current = setTimeout(() => {
        setConfirmingId(null)
      }, 4000)
      return
    }

    setChecking(attendee.id)
    const { data } = await supabase.from('event_attendees').update({
      checked_in: true,
      checked_in_at: new Date().toISOString(),
    }).eq('id', attendee.id).select().single()
    if (data) {
      setAttendees(prev => prev.map(a => a.id === data.id ? { ...a, ...data } as Attendee : a))
    }
    setChecking(null)
  }

  const handleConfirmUncheck = async (attendee: Attendee, ev: React.MouseEvent) => {
    ev.stopPropagation()
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmingId(null)
    setChecking(attendee.id)
    const { data } = await supabase.from('event_attendees').update({
      checked_in: false,
      checked_in_at: null,
    }).eq('id', attendee.id).select().single()
    if (data) {
      setAttendees(prev => prev.map(a => a.id === data.id ? { ...a, ...data } as Attendee : a))
    }
    setChecking(null)
  }

  const handleCancelConfirm = (ev: React.MouseEvent) => {
    ev.stopPropagation()
    if (confirmTimeoutRef.current) clearTimeout(confirmTimeoutRef.current)
    setConfirmingId(null)
  }

  const handleAddAdult = async () => {
    if (!newName.trim() || !event) return
    const { data, error } = await supabase.from('event_attendees').insert({
      event_id: event.id,
      name: newName.trim(),
      furigana: newFurigana.trim() || null,
      type: 'adult',
      is_reception: false,
      checked_in: true,
      checked_in_at: new Date().toISOString(),
    }).select().single()

    if (error) {
      alert('追加に失敗しました: ' + error.message)
      return
    }
    if (data) {
      setAttendees(prev => {
        if (prev.some(a => a.id === data.id)) return prev
        return [...prev, data as Attendee]
      })
    }
    setNewName('')
    setNewFurigana('')
    setShowAddForm(false)
  }

  const handleAddChild = async () => {
    if (!event) return
    const childCount = attendees.filter(a => a.type === 'child').length
    const childName = `子ども${childCount + 1}`
    const { data, error } = await supabase.from('event_attendees').insert({
      event_id: event.id,
      name: childName,
      furigana: null,
      type: 'child',
      is_reception: false,
      checked_in: true,
      checked_in_at: new Date().toISOString(),
    }).select().single()

    if (error) {
      alert('追加に失敗しました: ' + error.message)
      return
    }
    if (data) {
      setAttendees(prev => {
        if (prev.some(a => a.id === data.id)) return prev
        return [...prev, data as Attendee]
      })
    }
  }

  const handleCSVImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || !event) return
    setImporting(true)

    const text = await file.text()
    const lines = text.split('\n').filter(l => l.trim())
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''))
    const nameIdx = headers.indexOf('名前')
    const furiganaIdx = headers.indexOf('フリガナ')
    const emailIdx = headers.indexOf('メールアドレス')
    const productIdx = headers.indexOf('商品名')

    if (nameIdx === -1) {
      alert('「名前」列が見つかりません')
      setImporting(false)
      return
    }

    const newEntries = lines.slice(1)
      .map(line => {
        const cols = line.split(',').map(c => c.trim().replace(/"/g, ''))
        return {
          name: cols[nameIdx],
          furigana: furiganaIdx !== -1 ? cols[furiganaIdx] || null : null,
          email: emailIdx !== -1 ? cols[emailIdx] || null : null,
          is_reception: productIdx !== -1 ? cols[productIdx]?.includes('懇親会') || false : false,
        }
      })
      .filter(entry => entry.name && entry.name.length > 0)

    const existingNames = new Set(attendees.map(a => a.name))
    const toInsert = newEntries
      .filter(entry => !existingNames.has(entry.name))
      .map(entry => ({
        event_id: event.id,
        name: entry.name,
        furigana: entry.furigana,
        email: entry.email,
        type: 'adult',
        is_reception: entry.is_reception,
        checked_in: false,
        checked_in_at: null,
      }))

    if (toInsert.length === 0) {
      alert('追加する参加者がいません（全員既に登録済み）')
      setImporting(false)
      e.target.value = ''
      return
    }

    const { data, error } = await supabase.from('event_attendees').insert(toInsert).select()
    if (error) {
      alert('エラー: ' + error.message)
    } else {
      if (data) {
        setAttendees(prev => {
          const existingIds = new Set(prev.map(a => a.id))
          const toAdd = (data as Attendee[]).filter(a => !existingIds.has(a.id))
          return [...prev, ...toAdd]
        })
      }
      const receptionCount = toInsert.filter(a => a.is_reception).length
      alert(`${toInsert.length}名を取り込みました（懇親会あり: ${receptionCount}名）`)
    }
    setImporting(false)
    e.target.value = ''
  }

  const downloadCSV = () => {
    const headers = ['名前', 'フリガナ', 'メールアドレス', '種別', '懇親会', 'チェックイン', 'チェックイン時間']
    const rows = attendees.map(a => [
      a.name,
      a.furigana || '',
      a.email || '',
      a.type === 'child' ? '子ども' : '大人',
      a.is_reception ? 'あり' : 'なし',
      a.checked_in ? '済' : '未',
      a.checked_in_at ? new Date(a.checked_in_at).toLocaleString('ja-JP') : '',
    ])
    const csv = [headers, ...rows].map(row => row.join(',')).join('\n')
    const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8;' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `checkin_${new Date().toLocaleDateString('ja-JP').replace(/\//g, '-')}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const matchesSearch = (a: Attendee) => {
    if (!search) return true
    return (
      a.name.includes(search) ||
      (a.furigana ? a.furigana.includes(search) : false) ||
      (a.email ? a.email.toLowerCase().includes(search.toLowerCase()) : false)
    )
  }

  const adults = attendees.filter(a => a.type === 'adult')
  const children = attendees.filter(a => a.type === 'child')
  const filteredAdults = adults.filter(matchesSearch)
  const filteredChildren = children.filter(matchesSearch)
  const adultChecked = adults.filter(a => a.checked_in).length
  const childChecked = children.filter(a => a.checked_in).length

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <p className="text-gray-400 text-lg">読み込み中...</p>
      </div>
    )
  }

  if (!event) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-50">
        <p className="text-gray-400 text-lg">イベントが見つかりません</p>
      </div>
    )
  }

  const renderAttendeeButton = (attendee: Attendee, color: 'blue' | 'green') => {
    const isConfirming = confirmingId === attendee.id
    const bgClass = attendee.checked_in
      ? (color === 'blue' ? 'bg-blue-500 text-white' : 'bg-green-500 text-white')
      : 'bg-white text-gray-800 border border-gray-200'
    const iconBg = attendee.checked_in
      ? 'bg-white ' + (color === 'blue' ? 'text-blue-500' : 'text-green-500')
      : 'bg-gray-100 text-gray-300'

    const badgeClass = attendee.is_reception
      ? 'bg-pink-100 text-pink-700'
      : 'bg-yellow-100 text-yellow-700'
    const badgeLabel = attendee.is_reception ? '懇親会あり' : '懇親会なし'

    return (
      <div key={attendee.id} className="relative">
        <button
          type="button"
          onClick={() => handleCardTap(attendee)}
          disabled={checking === attendee.id}
          className={`w-full flex items-center justify-between p-4 rounded-2xl shadow-sm transition-all select-none ${bgClass}`}
        >
          <div className="text-left">
            <div className="flex items-center gap-2 mb-0.5">
              {attendee.furigana && (
                <p className={`text-xs ${attendee.checked_in ? 'text-white/80' : 'text-gray-400'}`}>
                  {attendee.furigana}
                </p>
              )}
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-medium ${badgeClass}`}>
                {badgeLabel}
              </span>
            </div>
            <p className="text-lg font-medium">{attendee.name}</p>
            {attendee.checked_in && attendee.checked_in_at && (
              <p className="text-xs text-white/80 mt-0.5">
                {new Date(attendee.checked_in_at).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit' })} チェックイン
              </p>
            )}
          </div>
          <div className={`w-10 h-10 rounded-full flex items-center justify-center text-xl flex-shrink-0 ${iconBg}`}>
            {checking === attendee.id ? '…' : attendee.checked_in ? '✓' : '○'}
          </div>
        </button>

        {isConfirming && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 rounded-2xl bg-black/60 backdrop-blur-sm">
            <button
              type="button"
              onClick={(ev) => handleConfirmUncheck(attendee, ev)}
              className="bg-orange-500 text-white px-5 py-2.5 rounded-xl font-semibold text-sm shadow-lg"
            >
              取消する
            </button>
            <button
              type="button"
              onClick={handleCancelConfirm}
              className="bg-white text-gray-600 px-5 py-2.5 rounded-xl font-semibold text-sm shadow-lg"
            >
              閉じる
            </button>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="max-w-lg mx-auto p-4 pb-8 min-h-screen bg-gray-50">

      <div className="bg-white rounded-2xl shadow-sm p-5 mb-4">
        <h1 className="text-xl font-bold text-gray-800">{event.name}</h1>
        <p className="text-gray-400 text-sm mt-1">
          {new Date(event.event_date).toLocaleDateString('ja-JP', { year: 'numeric', month: 'long', day: 'numeric' })}
        </p>
        <div className="mt-4 flex gap-6">
          <div className="flex-1">
            <p className="text-xs text-gray-400 mb-1">大人</p>
            <div className="flex items-end gap-1">
              <span className="text-4xl font-bold text-blue-500">{adultChecked}</span>
              <span className="text-gray-400 mb-1">/ {adults.length} 名</span>
            </div>
            <div className="mt-2 w-full bg-gray-100 rounded-full h-1.5">
              <div className="bg-blue-500 h-1.5 rounded-full transition-all duration-500"
                style={{ width: adults.length > 0 ? `${(adultChecked / adults.length) * 100}%` : '0%' }} />
            </div>
          </div>
          <div className="flex-1">
            <p className="text-xs text-gray-400 mb-1">子ども</p>
            <div className="flex items-end gap-1">
              <span className="text-4xl font-bold text-green-500">{childChecked}</span>
              <span className="text-gray-400 mb-1">/ {children.length} 名</span>
            </div>
            <div className="mt-2 w-full bg-gray-100 rounded-full h-1.5">
              <div className="bg-green-500 h-1.5 rounded-full transition-all duration-500"
                style={{ width: children.length > 0 ? `${(childChecked / children.length) * 100}%` : '0%' }} />
            </div>
          </div>
        </div>
      </div>

      <div className="mb-3">
        <input
          type="text"
          placeholder="名前・フリガナ・メールアドレスで検索..."
          value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-full p-4 rounded-2xl border border-gray-200 bg-white shadow-sm text-lg focus:outline-none focus:ring-2 focus:ring-blue-400"
        />
      </div>

      <div className="mb-3">
        <button
          onClick={() => setIsAdultOpen(!isAdultOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-white rounded-2xl shadow-sm mb-2"
        >
          <span className="font-semibold text-gray-700">大人 ({adultChecked}/{adults.length}名)</span>
          <span className="text-gray-400 text-lg">{isAdultOpen ? '▲' : '▼'}</span>
        </button>
        {isAdultOpen && (
          <div className="space-y-2">
            {filteredAdults.map(attendee => renderAttendeeButton(attendee, 'blue'))}
            {filteredAdults.length === 0 && (
              <p className="text-center text-gray-300 py-6">該当者なし</p>
            )}
          </div>
        )}
      </div>

      <div className="mb-4">
        <button
          onClick={() => setIsChildOpen(!isChildOpen)}
          className="w-full flex items-center justify-between px-4 py-3 bg-white rounded-2xl shadow-sm mb-2"
        >
          <span className="font-semibold text-gray-700">子ども ({childChecked}/{children.length}名)</span>
          <span className="text-gray-400 text-lg">{isChildOpen ? '▲' : '▼'}</span>
        </button>
        {isChildOpen && (
          <div className="space-y-2">
            {filteredChildren.map(attendee => renderAttendeeButton(attendee, 'green'))}
            {filteredChildren.length === 0 && (
              <p className="text-center text-gray-300 py-6">子どもの参加者なし</p>
            )}
          </div>
        )}
      </div>

      {showAddForm ? (
        <div className="bg-white rounded-2xl shadow-sm p-4 mb-3 border border-gray-200">
          <p className="text-sm font-semibold text-gray-600 mb-3">飛び込み参加者を追加</p>
          <input
            type="text"
            placeholder="フリガナ（任意）"
            value={newFurigana}
            onChange={e => setNewFurigana(e.target.value)}
            className="w-full p-3 border border-gray-200 rounded-xl mb-2 focus:outline-none focus:ring-2 focus:ring-blue-400 text-lg"
          />
          <input
            type="text"
            placeholder="大人の名前を入力"
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAddAdult()}
            className="w-full p-3 border border-gray-200 rounded-xl mb-3 focus:outline-none focus:ring-2 focus:ring-blue-400 text-lg"
            autoFocus
          />
          <div className="flex gap-2 mb-2">
            <button onClick={handleAddAdult} className="flex-1 bg-blue-500 text-white py-3 rounded-xl font-semibold">
              大人を追加
            </button>
            <button onClick={() => { setShowAddForm(false); setNewName(''); setNewFurigana('') }} className="flex-1 bg-gray-100 text-gray-500 py-3 rounded-xl font-semibold">
              キャンセル
            </button>
          </div>
          <button onClick={handleAddChild} className="w-full bg-green-500 text-white py-3 rounded-xl font-semibold">
            子どもを追加（自動採番）
          </button>
        </div>
      ) : (
        <button
          onClick={() => setShowAddForm(true)}
          className="w-full bg-white border-2 border-dashed border-gray-200 text-gray-400 py-4 rounded-2xl mb-3 text-lg hover:bg-gray-50 transition-colors"
        >
          ＋ 飛び込み参加者を追加
        </button>
      )}

      <input ref={fileInputRef} type="file" accept=".csv" onChange={handleCSVImport} className="hidden" />
      <button
        onClick={() => fileInputRef.current?.click()}
        disabled={importing}
        className={`w-full py-4 rounded-2xl font-semibold text-lg mb-3 transition-colors
          ${importing ? 'bg-gray-200 text-gray-400' : 'bg-green-500 text-white hover:bg-green-600'}`}
      >
        {importing ? '取り込み中...' : 'CSVで名簿を取り込む'}
      </button>

      <button
        onClick={downloadCSV}
        className="w-full bg-gray-800 text-white py-4 rounded-2xl font-semibold text-lg"
      >
        CSVダウンロード
      </button>
    </div>
  )
}