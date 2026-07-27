// 此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供
import React, { useEffect, useRef, useState } from 'react'

export interface PreviewData {
  layers: Record<string, any[]>
  layer_colors?: Record<string, number[]>
  layer_order?: string[]
  bounds: { min: [number, number]; max: [number, number] }
}

interface Preview2DProps {
  data: PreviewData | null
  fitKey?: string
}

interface LayerMode {
  filled: boolean
  visible: boolean
  planes: boolean
  traces: boolean
  pads: boolean
  vias: boolean
  components: boolean
}

const DEFAULT_MODE: LayerMode = {
  filled: true,
  visible: true,
  planes: true,
  traces: true,
  pads: true,
  vias: true,
  components: true,
}

const LAYER_COLS: { key: keyof LayerMode; icon: string; title: string; color: string }[] = [
  { key: 'filled', icon: '▣', title: '填滿／框線', color: '#ffd700' },
  { key: 'visible', icon: '◉', title: '顯示／隱藏', color: '#aeb8c4' },
  { key: 'planes', icon: '▰', title: '銅箔平面', color: '#58a6ff' },
  { key: 'traces', icon: '╱', title: '導線', color: '#58a6ff' },
  { key: 'pads', icon: '●', title: '焊盤', color: '#58a6ff' },
  { key: 'vias', icon: '⊙', title: '過孔', color: '#58a6ff' },
  { key: 'components', icon: '◇', title: '元件', color: '#58a6ff' },
]

// SIwave 風格深色背景與預設層色（EDB 未提供層色時的備援）
const BG_COLOR = '#0c0e12'
const BOARD_FILL = 'rgba(18, 62, 28, 0.85)'
const BOARD_STROKE = '#4caf50'
const FALLBACK_PALETTE = [
  '#ff3b30', '#00e676', '#ffd600', '#00b0ff', '#e040fb',
  '#ff9100', '#18ffff', '#c6ff00', '#ff4081', '#7c4dff',
]

function ItemPanel({
  filter, onFilter, placeholder, items, values, onToggle, onAll, emptyText
}: {
  filter: string
  onFilter: (value: string) => void
  placeholder: string
  items: string[]
  values: Record<string, boolean>
  onToggle: (name: string) => void
  onAll: (value: boolean) => void
  emptyText: string
}) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0 }}>
      <div style={{ display: 'flex', gap: 6, padding: 9 }}>
        <input
          value={filter}
          onChange={e => onFilter(e.target.value)}
          placeholder={placeholder}
          style={{ flex: 1, minWidth: 0, padding: '6px 8px', color: '#e0e6ed', background: '#0d1117', border: '1px solid #30363d', borderRadius: 5 }}
        />
        <button onClick={() => onAll(true)} style={{ padding: '4px 7px', color: '#e0e6ed', background: '#21262d', border: '1px solid #30363d', borderRadius: 4, cursor: 'pointer' }}>全選</button>
        <button onClick={() => onAll(false)} style={{ padding: '4px 7px', color: '#e0e6ed', background: '#21262d', border: '1px solid #30363d', borderRadius: 4, cursor: 'pointer' }}>全不選</button>
      </div>
      <div style={{ overflowY: 'auto', flex: 1 }}>
        {items.map(name => (
          <label key={name} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px', cursor: 'pointer' }}>
            <input type="checkbox" checked={!!values[name]} onChange={() => onToggle(name)} style={{ width: 14, height: 14, accentColor: '#58a6ff' }} />
            <span title={name} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{name}</span>
          </label>
        ))}
        {items.length === 0 && <div style={{ padding: 18, textAlign: 'center', color: '#6e7681' }}>{emptyText}</div>}
      </div>
    </div>
  )
}

export default function Preview2D({ data, fitKey }: Preview2DProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  // Viewport transform
  const [transform, setTransform] = useState({ x: 0, y: 0, scale: 1 })
  const [isDragging, setIsDragging] = useState(false)
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 })

  const [layerModes, setLayerModes] = useState<Record<string, LayerMode>>({})
  const [visibleComps, setVisibleComps] = useState<Record<string, boolean>>({})
  const [visibleNets, setVisibleNets] = useState<Record<string, boolean>>({})
  const [panelOpen, setPanelOpen] = useState(true)
  const [activeTab, setActiveTab] = useState<'Layers' | 'Components' | 'Nets'>('Layers')
  const [compFilter, setCompFilter] = useState('')
  const [netFilter, setNetFilter] = useState('')

  // Initialize visibility when data changes
  useEffect(() => {
    if (data && data.layers) {
      const modes: Record<string, LayerMode> = {}
      const comps: Record<string, boolean> = {}
      const nets: Record<string, boolean> = {}
      Object.keys(data.layers).forEach(layer => {
        modes[layer] = { ...DEFAULT_MODE }
        data.layers[layer].forEach(prim => {
          if (prim.kind === 'comp' && prim.name) comps[prim.name] = true
          if (prim.net) nets[prim.net] = true
        })
      })
      setLayerModes(modes)
      setVisibleComps(comps)
      setVisibleNets(nets)
    }
  }, [data])

  // 掃描所有實際圖元的座標範圍（比後端 bounds 更貼合線路）
  const computeContentBounds = (): { min: [number, number]; max: [number, number] } | null => {
    if (!data) return null
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity
    const expand = (x: number, y: number) => {
      if (x < minX) minX = x
      if (y < minY) minY = y
      if (x > maxX) maxX = x
      if (y > maxY) maxY = y
    }
    for (const prims of Object.values(data.layers)) {
      for (const prim of prims) {
        if (prim.kind === 'rect' || prim.kind === 'comp') {
          expand(prim.x, prim.y)
          expand(prim.x + prim.w, prim.y + prim.h)
        } else if (prim.kind === 'circle') {
          expand(prim.x - prim.r, prim.y - prim.r)
          expand(prim.x + prim.r, prim.y + prim.r)
        } else if ((prim.kind === 'polygon' || prim.kind === 'path') && prim.points) {
          for (const p of prim.points) expand(p[0], p[1])
        }
      }
    }
    if (!isFinite(minX) || maxX - minX <= 0 || maxY - minY <= 0) return null
    return { min: [minX, minY], max: [maxX, maxY] }
  }

  // 將視野調整為剛好容納全部圖元（Fit All）
  const fitView = () => {
    if (!data || !containerRef.current) return
    const { min, max } = computeContentBounds() || data.bounds
    const contentW = max[0] - min[0]
    const contentH = max[1] - min[1]
    if (contentW <= 0 || contentH <= 0) return

    const containerW = containerRef.current.clientWidth
    const containerH = containerRef.current.clientHeight

    const scaleX = (containerW * 0.85) / contentW
    const scaleY = (containerH * 0.85) / contentH
    const newScale = Math.min(scaleX, scaleY)

    const cx = (min[0] + max[0]) / 2
    const cy = (min[1] + max[1]) / 2

    setTransform({
      x: containerW / 2 - cx * newScale,
      y: -containerH / 2 + cy * newScale,
      scale: newScale
    })
  }

  // Fit to screen on data load
  useEffect(() => {
    fitView()
  }, [data, fitKey])

  // 依層名解析顏色：優先使用 EDB 實際層色，否則以雜湊取備援調色盤
  const getLayerColor = (layer: string): string => {
    if (layer === 'Board') return BOARD_STROKE
    if (layer === 'Vias') return '#cfd8dc'
    if (layer === 'Components') return '#90caf9'
    const ec = data?.layer_colors?.[layer]
    if (ec && ec.length >= 3) return `rgb(${ec[0]}, ${ec[1]}, ${ec[2]})`
    let hash = 0
    for (let i = 0; i < layer.length; i++) hash = (hash * 31 + layer.charCodeAt(i)) >>> 0
    return FALLBACK_PALETTE[hash % FALLBACK_PALETTE.length]
  }

  // 訊號層的疊構順序（由上至下）；未在 layer_order 中的層附加在最後
  const getStackupLayers = (): string[] => {
    if (!data) return []
    const inData = Object.keys(data.layers).filter(
      l => l !== 'Board' && l !== 'Vias' && l !== 'Components'
    )
    const ordered = (data.layer_order || []).filter(l => inData.includes(l))
    const extras = inData.filter(l => !ordered.includes(l))
    return [...ordered, ...extras]
  }

  // Draw loop
  const drawCanvas = () => {
    const canvas = canvasRef.current
    const container = containerRef.current
    if (!canvas || !container) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    // Setup High-DPI canvas
    const dpr = window.devicePixelRatio || 1
    const rect = container.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return

    canvas.width = rect.width * dpr
    canvas.height = rect.height * dpr
    ctx.scale(dpr, dpr)
    canvas.style.width = `${rect.width}px`
    canvas.style.height = `${rect.height}px`

    // SIwave 風格深色背景
    ctx.fillStyle = BG_COLOR
    ctx.fillRect(0, 0, rect.width, rect.height)

    if (!data) return

    // Apply transform (flip Y axis: ECAD Y grows up, Canvas Y grows down)
    ctx.save()
    ctx.translate(transform.x, transform.y + rect.height)
    ctx.scale(transform.scale, -transform.scale)

    const px = (n: number) => n / transform.scale // n 螢幕像素對應的世界座標長度

    // 繪製多邊形（含破孔，evenodd）
    const tracePolygon = (pts: number[][], holes?: number[][][]) => {
      ctx.beginPath()
      ctx.moveTo(pts[0][0], pts[0][1])
      for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
      ctx.closePath()
      if (holes) {
        for (const hole of holes) {
          if (hole.length < 3) continue
          ctx.moveTo(hole[0][0], hole[0][1])
          for (let i = 1; i < hole.length; i++) ctx.lineTo(hole[i][0], hole[i][1])
          ctx.closePath()
        }
      }
    }

    // 圖層繪製順序（同 SIwave）：Board 最底 → 訊號層由「最底層」往「最頂層」畫
    // （頂層最後畫、最清楚）→ Components → Vias 最上
    const stackup = getStackupLayers()
    const layerOrder = ['Board', ...[...stackup].reverse(), 'Components', 'Vias']

    for (const layerName of layerOrder) {
      if (!data.layers[layerName]) continue
      const mode = layerModes[layerName] || DEFAULT_MODE
      if (!mode.visible) continue

      const prims = data.layers[layerName]
      const color = getLayerColor(layerName)

      ctx.fillStyle = color
      ctx.strokeStyle = color
      ctx.lineJoin = 'round'
      ctx.lineCap = 'round'

      prims.forEach(prim => {
        if (prim.kind === 'polygon' && !mode.planes) return
        if (prim.kind === 'path' && !mode.traces) return
        if (prim.kind === 'circle' && layerName === 'Vias' && !mode.vias) return
        if (prim.kind === 'circle' && layerName !== 'Vias' && !mode.pads) return
        if (prim.kind === 'comp' && !mode.components) return
        if (prim.kind === 'comp' && prim.name && visibleComps[prim.name] === false) return
        if (prim.net && visibleNets[prim.net] === false) return
        if (layerName === 'Board' && prim.kind === 'rect') {
          // 板框：暗綠填色 + 亮綠外框（SIwave 風格）
          ctx.fillStyle = BOARD_FILL
          ctx.fillRect(prim.x, prim.y, prim.w, prim.h)
          ctx.strokeStyle = BOARD_STROKE
          ctx.lineWidth = px(1.2)
          ctx.strokeRect(prim.x, prim.y, prim.w, prim.h)
          ctx.fillStyle = color
          return
        }

        if (prim.kind === 'polygon') {
          const pts = prim.points
          if (pts && pts.length >= 3) {
            ctx.globalAlpha = 0.85
            tracePolygon(pts, prim.holes)
            if (mode.filled) ctx.fill('evenodd')
            else {
              ctx.globalAlpha = 1
              ctx.lineWidth = px(0.8)
              ctx.stroke()
            }
            ctx.globalAlpha = 1.0
          }
        } else if (prim.kind === 'path') {
          const pts = prim.points
          if (pts && pts.length >= 2) {
            ctx.globalAlpha = 0.95
            ctx.lineWidth = Math.max(prim.width || 0.1, px(0.75))
            ctx.beginPath()
            ctx.moveTo(pts[0][0], pts[0][1])
            for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1])
            ctx.stroke()
            ctx.globalAlpha = 1.0
          }
        } else if (prim.kind === 'rect') {
          ctx.globalAlpha = 0.8
          ctx.fillRect(prim.x, prim.y, prim.w, prim.h)
          ctx.globalAlpha = 1.0
        } else if (prim.kind === 'comp') {
          // 元件外框：僅描邊 + 淡填色
          ctx.globalAlpha = 0.9
          ctx.lineWidth = px(1)
          ctx.strokeRect(prim.x, prim.y, prim.w, prim.h)
          ctx.globalAlpha = 0.15
          ctx.fillRect(prim.x, prim.y, prim.w, prim.h)
          ctx.globalAlpha = 1.0
        } else if (prim.kind === 'circle') {
          ctx.beginPath()
          ctx.arc(prim.x, prim.y, Math.max(prim.r, px(1)), 0, 2 * Math.PI)
          ctx.fill()
          // 過孔中心鑽孔（深色小圓）模擬 SIwave 外觀
          if (prim.r > px(3)) {
            ctx.fillStyle = BG_COLOR
            ctx.beginPath()
            ctx.arc(prim.x, prim.y, prim.r * 0.45, 0, 2 * Math.PI)
            ctx.fill()
            ctx.fillStyle = color
          }
        }
      })
    }

    ctx.restore()
  }

  useEffect(() => {
    drawCanvas()
  }, [data, transform, layerModes, visibleComps, visibleNets])

  // ResizeObserver to redraw when container size changes
  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const observer = new ResizeObserver(() => drawCanvas())
    observer.observe(container)
    return () => observer.disconnect()
  }, [data, transform, layerModes, visibleComps, visibleNets])

  // Mouse Handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault()
    const zoomSensitivity = 0.001
    const zoomFactor = Math.exp(-e.deltaY * zoomSensitivity)

    const rect = canvasRef.current!.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top

    setTransform(prev => ({
      x: mouseX - (mouseX - prev.x) * zoomFactor,
      y: mouseY - (mouseY - prev.y) * zoomFactor,
      scale: prev.scale * zoomFactor
    }))
  }

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true)
    setDragStart({ x: e.clientX - transform.x, y: e.clientY - transform.y })
  }

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return
    setTransform(prev => ({
      ...prev,
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y
    }))
  }

  const handleMouseUp = () => {
    setIsDragging(false)
  }

  const toggleLayerCol = (layer: string, key: keyof LayerMode) => {
    setLayerModes(prev => ({
      ...prev,
      [layer]: { ...(prev[layer] || DEFAULT_MODE), [key]: !(prev[layer] || DEFAULT_MODE)[key] }
    }))
  }

  const toggleAllCol = (key: keyof LayerMode) => {
    if (!data) return
    const turnOn = !Object.keys(data.layers).every(layer => (layerModes[layer] || DEFAULT_MODE)[key])
    setLayerModes(prev => {
      const next = { ...prev }
      Object.keys(data.layers).forEach(layer => {
        next[layer] = { ...(next[layer] || DEFAULT_MODE), [key]: turnOn }
      })
      return next
    })
  }

  // Layers 面板列表：訊號層依疊構由上至下，特殊層（Board/Components/Vias）列在下方
  const stackupLayers = getStackupLayers()
  const specialLayers = data
    ? ['Vias', 'Components', 'Board'].filter(l => data.layers[l])
    : []

  const allDisplayLayers = [...stackupLayers, ...specialLayers]
  const filteredComps = Object.keys(visibleComps).sort().filter(name =>
    name.toLowerCase().includes(compFilter.toLowerCase()))
  const filteredNets = Object.keys(visibleNets).sort().filter(name =>
    name.toLowerCase().includes(netFilter.toLowerCase()))
  const setAllItems = (type: 'components' | 'nets', value: boolean) => {
    const source = type === 'components' ? visibleComps : visibleNets
    const next: Record<string, boolean> = {}
    Object.keys(source).forEach(name => { next[name] = value })
    if (type === 'components') setVisibleComps(next)
    else setVisibleNets(next)
  }

  return (
    <div
      style={{ width: '100%', height: '100%', display: 'flex', overflow: 'hidden', background: BG_COLOR }}
    >
      <div
        ref={containerRef}
        style={{ flex: 1, position: 'relative', overflow: 'hidden', minWidth: 0 }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <canvas ref={canvasRef} style={{ cursor: isDragging ? 'grabbing' : 'grab', display: 'block' }} />
        {data && (
          <button type="button" onMouseDown={e => e.stopPropagation()} onClick={e => { e.stopPropagation(); fitView() }}
            title="縮放至全板（Fit All）"
            style={{ position: 'absolute', right: 12, bottom: 12, zIndex: 10, padding: '6px 13px', fontSize: 12, fontWeight: 600, background: 'rgba(22,28,40,0.95)', color: '#e0e6ed', border: '1px solid rgba(255,255,255,0.2)', borderRadius: 6, cursor: 'pointer' }}>
            ⛶ Fit All
          </button>
        )}
      </div>

      {data && Object.keys(data.layers).length > 0 && (
        <div style={{ display: 'flex', flexShrink: 0 }}>
          <button type="button" onClick={() => setPanelOpen(open => !open)} title={panelOpen ? '收合管理面板' : '展開管理面板'}
            style={{ width: 16, padding: 0, border: 0, borderLeft: '1px solid rgba(255,255,255,0.08)', background: 'rgba(22,28,40,0.98)', color: '#8b949e', cursor: 'pointer', fontSize: 10 }}>
            {panelOpen ? '▶' : '◀'}
          </button>
          {panelOpen && (
            <aside style={{ width: 374, display: 'flex', flexDirection: 'column', background: 'rgba(14,18,26,0.98)', borderLeft: '1px solid rgba(255,255,255,0.10)', color: '#e0e6ed', fontSize: 12.5, overflow: 'hidden' }}
              onWheel={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
              <div style={{ display: 'flex', borderBottom: '1px solid rgba(255,255,255,0.10)', padding: '0 8px' }}>
                {(['Layers', 'Components', 'Nets'] as const).map(tab => (
                  <button key={tab} onClick={() => setActiveTab(tab)}
                    style={{ padding: '9px 12px', border: 0, borderBottom: activeTab === tab ? '2px solid #58a6ff' : '2px solid transparent', background: 'transparent', color: activeTab === tab ? '#f0f6fc' : '#8b949e', fontWeight: activeTab === tab ? 700 : 500, cursor: 'pointer' }}>
                    {tab}
                  </button>
                ))}
              </div>

              {activeTab === 'Layers' && (
                <div style={{ overflow: 'auto', flex: 1 }}>
                  <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
                    <colgroup><col />{LAYER_COLS.map(col => <col key={col.key} style={{ width: 28 }} />)}</colgroup>
                    <thead>
                      <tr style={{ background: 'rgba(255,255,255,0.03)', borderBottom: '1px solid rgba(255,255,255,0.1)' }}>
                        <th style={{ textAlign: 'left', padding: '7px 10px', color: '#8b949e', fontSize: 11 }}>Name</th>
                        {LAYER_COLS.map(col => <th key={col.key} title={`${col.title}（點擊切換全部）`} onClick={() => toggleAllCol(col.key)}
                          style={{ textAlign: 'center', cursor: 'pointer', color: col.color, fontSize: 14 }}>{col.icon}</th>)}
                      </tr>
                    </thead>
                    <tbody>
                      {allDisplayLayers.map(layer => {
                        const mode = layerModes[layer] || DEFAULT_MODE
                        const color = getLayerColor(layer)
                        return (
                          <tr key={layer} style={{ opacity: mode.visible ? 1 : 0.45 }}>
                            <td style={{ padding: '4px 10px' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ width: 12, height: 10, background: color, border: '1px solid rgba(255,255,255,0.4)' }} />
                                <span title={layer} style={{ color, fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{layer}</span>
                              </div>
                            </td>
                            {LAYER_COLS.map(col => <td key={col.key} style={{ textAlign: 'center', padding: 3 }}>
                              <input type="checkbox" checked={!!mode[col.key]} onChange={() => toggleLayerCol(layer, col.key)} title={col.title}
                                style={{ width: 14, height: 14, cursor: 'pointer', accentColor: color }} />
                            </td>)}
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              {activeTab === 'Components' && <ItemPanel filter={compFilter} onFilter={setCompFilter} placeholder="搜尋元件…" items={filteredComps} values={visibleComps} onToggle={name => setVisibleComps(prev => ({ ...prev, [name]: !prev[name] }))} onAll={value => setAllItems('components', value)} emptyText="無元件資料" />}
              {activeTab === 'Nets' && <ItemPanel filter={netFilter} onFilter={setNetFilter} placeholder="搜尋網路…" items={filteredNets} values={visibleNets} onToggle={name => setVisibleNets(prev => ({ ...prev, [name]: !prev[name] }))} onAll={value => setAllItems('nets', value)} emptyText="無網路資料" />}
            </aside>
          )}
        </div>
      )}
    </div>
  )
}
