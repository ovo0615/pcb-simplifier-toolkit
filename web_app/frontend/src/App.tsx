import { useState, useEffect, useRef } from 'react'
import { Allotment } from 'allotment'
import 'allotment/dist/style.css'
import Preview2D, { PreviewData } from './components/Preview2D'

export default function App() {
  const [inputPath, setInputPath] = useState('')
  const [outputPath, setOutputPath] = useState('')
  const [allNets, setAllNets] = useState<string[]>([])
  const [selectedNets, setSelectedNets] = useState<string[]>([])
  const [filterText, setFilterText] = useState('')
  const [scene, setScene] = useState<PreviewData | null>(null)                     // 原始完整板
  const [simplifiedScene, setSimplifiedScene] = useState<PreviewData | null>(null) // 精簡後預覽
  const [logs, setLogs] = useState<string[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [isPreviewLoading, setIsPreviewLoading] = useState(false)
  
  const wsRef = useRef<WebSocket | null>(null)
  const logBoxRef = useRef<HTMLDivElement | null>(null)

  // 新日誌進來時自動捲到最底；若使用者正往上捲閱讀舊訊息（離底部較遠）則不打擾
  useEffect(() => {
    const box = logBoxRef.current
    if (!box) return
    const nearBottom = box.scrollHeight - box.scrollTop - box.clientHeight < 60
    if (nearBottom) {
      box.scrollTop = box.scrollHeight
    }
  }, [logs])

  useEffect(() => {
    // Setup WebSocket for logs
    const ws = new WebSocket(`ws://${window.location.host}/ws/logs`)
    ws.onmessage = (event) => {
      setLogs((prev) => [...prev, event.data])
    }
    wsRef.current = ws
    return () => ws.close()
  }, [])

  const handleBrowseInput = async () => {
    try {
      const res = await fetch('/api/browse_input')
      const data = await res.json()
      if (data.path) {
        setInputPath(data.path)
        const base = data.path.replace(/\.[^/.]+$/, "")
        setOutputPath(base + "_Simplified.aedb")
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleBrowseOutput = async () => {
    try {
      const res = await fetch('/api/browse_output')
      const data = await res.json()
      if (data.path) {
        setOutputPath(data.path)
      }
    } catch (e) {
      console.error(e)
    }
  }

  const handleLoadFile = async () => {
    if (!inputPath) {
      alert("請輸入檔案路徑")
      return
    }
    setIsLoading(true)
    try {
      const res = await fetch('/api/load', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: inputPath })
      })
      const data = await res.json()
      if (res.ok) {
        setAllNets(data.nets)
        setSelectedNets([]) // reset
        const normalized = data.path || inputPath
        setInputPath(normalized)
        const base = normalized.replace(/\.[^/.]+$/, "")
        setOutputPath(base + "_Simplified.aedb")
        // 載入時抓一次完整板預覽
        setSimplifiedScene(null)
        const full = await fetchPreview(data.nets)
        if (full) setScene(full)
      } else {
        alert("載入失敗: " + data.detail)
      }
    } catch (e) {
      alert("網路錯誤: " + String(e))
    } finally {
      setIsLoading(false)
    }
  }

  // 依 keep_nets 向後端要一份預覽資料
  const fetchPreview = async (keepNets: string[]): Promise<PreviewData | null> => {
    try {
      const res = await fetch('/api/preview', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep_nets: keepNets })
      })
      const data = await res.json()
      if (res.ok) return data
    } catch (e) {
      console.error(e)
    }
    return null
  }

  // 選取網路變動時，更新右側「精簡後」預覽（防抖 500ms）；未選取則收合為單一畫面
  useEffect(() => {
    if (allNets.length === 0) return
    if (selectedNets.length === 0) {
      setSimplifiedScene(null)
      return
    }
    const timer = setTimeout(async () => {
      setIsPreviewLoading(true)
      try {
        const s = await fetchPreview(selectedNets)
        if (s) setSimplifiedScene(s)
      } finally {
        setIsPreviewLoading(false)
      }
    }, 500)
    return () => clearTimeout(timer)
  }, [selectedNets, allNets])

  const handleSimplify = async () => {
    if (selectedNets.length === 0) {
      alert("請先選擇要保留的網路")
      return
    }
    if (!outputPath) {
      alert("請設定輸出路徑")
      return
    }
    setIsLoading(true)
    try {
      const res = await fetch('/api/simplify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ keep_nets: selectedNets, output_path: outputPath })
      })
      const data = await res.json()
      if (!res.ok) {
        alert("簡化失敗: " + data.detail)
      }
    } catch (e) {
      alert("網路錯誤: " + String(e))
    } finally {
      setIsLoading(false)
    }
  }

  const handleAdd = (net: string) => {
    if (!selectedNets.includes(net)) {
      setSelectedNets([...selectedNets, net])
    }
  }

  const handleRemove = (net: string) => {
    setSelectedNets(selectedNets.filter(n => n !== net))
  }

  const availableFiltered = allNets
    .filter(n => !selectedNets.includes(n))
    .filter(n => n.toLowerCase().includes(filterText.toLowerCase()))

  return (
    <div className="app-shell">
      {isLoading && (
        <div style={{
          position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
          background: 'rgba(255,255,255,0.7)', backdropFilter: 'blur(4px)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          zIndex: 9999, fontSize: '1.2rem', fontWeight: 'bold', color: 'var(--accent)'
        }}>
          處理中...
        </div>
      )}

      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <h1 className="app-title">PCB Simplifier Toolkit</h1>
          <p className="app-sub">
            2D Layout 預覽 + 網路清單萃取與 EDB 幾何簡化。此工具由虎門科技資深技術工程師 Jeff Hong 洪敬傑提供。
          </p>
        </div>
        <img 
          src="/logo.png" 
          alt="虎門科技" 
          style={{ height: "80px", objectFit: "contain", marginLeft: "24px", display: "block" }} 
          onError={(e) => { e.currentTarget.style.display = 'none'; }}
        />
      </header>

      <main style={{ flex: 1, minHeight: 0 }}>
        <Allotment>
          {/* 左側：設定面板 */}
          <Allotment.Pane preferredSize={380} minSize={300}>
            <div style={{ paddingRight: 7, height: "100%" }}>
              <div className="panel" style={{ padding: 18, display: 'flex', flexDirection: 'column', height: "100%", gap: '16px' }}>
                
                <div>
                  <h3 className="panel-title">1. 輸入檔案 (.tgz, .aedb)</h3>
                  <div className="field-row" style={{ marginTop: 8 }}>
                    <input 
                      type="text" 
                      className="input"
                      value={inputPath} 
                      onChange={e => setInputPath(e.target.value)} 
                      placeholder="path\to\file.aedb"
                    />
                    <button className="btn" onClick={handleBrowseInput}>瀏覽...</button>
                  </div>
                  <button className="btn--primary" onClick={handleLoadFile} style={{ marginTop: 8 }}>載入網路清單</button>
                </div>

                <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                  <h3 className="panel-title">2. 選擇保留的網路 (Nets)</h3>
                  <input 
                    type="text" 
                    className="input"
                    placeholder="過濾關鍵字..." 
                    value={filterText} 
                    onChange={e => setFilterText(e.target.value)} 
                    style={{ marginTop: 8, marginBottom: 8 }}
                  />
                  <div style={{ display: 'flex', gap: '8px', flex: 1, minHeight: 0 }}>
                    <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: '#fff', overflowY: 'auto', padding: 4 }}>
                      {availableFiltered.map(net => (
                        <div key={net} style={{ padding: '4px 8px', cursor: 'pointer', fontSize: '13px', borderRadius: '4px' }} onDoubleClick={() => handleAdd(net)} onMouseEnter={(e) => e.currentTarget.style.background = 'var(--bg-0)'} onMouseLeave={(e) => e.currentTarget.style.background = 'transparent'}>
                          {net}
                        </div>
                      ))}
                    </div>
                    <div style={{ flex: 1, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: '#fff', overflowY: 'auto', padding: 4 }}>
                      {selectedNets.map(net => (
                        <div key={net} style={{ padding: '4px 8px', cursor: 'pointer', fontSize: '13px', borderRadius: '4px', background: 'var(--accent-soft)', color: 'var(--accent)', marginBottom: 2 }} onDoubleClick={() => handleRemove(net)}>
                          {net}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div style={{ fontSize: '11px', color: 'var(--muted)', marginTop: 4, textAlign: 'center' }}>
                    *雙擊項目以移動
                  </div>
                </div>

                <div>
                  <h3 className="panel-title">3. 儲存設定</h3>
                  <div className="field-row" style={{ marginTop: 8 }}>
                    <input 
                      type="text" 
                      className="input"
                      value={outputPath} 
                      onChange={e => setOutputPath(e.target.value)} 
                      placeholder="輸出路徑..." 
                    />
                    <button className="btn" onClick={handleBrowseOutput}>瀏覽...</button>
                  </div>
                  <button className="btn--primary" onClick={handleSimplify} disabled={selectedNets.length === 0} style={{ marginTop: 8 }}>
                    開始簡化設計
                  </button>
                </div>

              </div>
            </div>
          </Allotment.Pane>

          {/* 右側：3D 預覽與日誌 */}
          <Allotment.Pane>
            <div style={{ paddingLeft: 7, height: "100%" }}>
              <Allotment vertical>
                {/* 3D 預覽 */}
                <Allotment.Pane minSize={200}>
                  <div style={{ paddingBottom: 7, height: "100%" }}>
                    <div className="panel" style={{ overflow: "hidden", position: "relative", height: "100%", background: "#0c0e12" }}>
                      {simplifiedScene ? (
                        /* 分割對照：左＝原始完整板，右＝精簡後 */
                        <Allotment>
                          <Allotment.Pane minSize={150}>
                            <div style={{ position: "relative", height: "100%", borderRight: "1px solid rgba(255,255,255,0.15)" }}>
                              <div style={{ position: "absolute", top: 12, left: 16, zIndex: 1, fontSize: 12.5, fontWeight: 700, color: "#9fb0c3", pointerEvents: "none" }}>
                                原始電路板
                              </div>
                              <Preview2D data={scene} fitKey={inputPath} />
                            </div>
                          </Allotment.Pane>
                          <Allotment.Pane minSize={150}>
                            <div style={{ position: "relative", height: "100%" }}>
                              <div style={{ position: "absolute", top: 12, left: 16, zIndex: 1, fontSize: 12.5, fontWeight: 700, color: "#7ee787", pointerEvents: "none" }}>
                                精簡後（保留 {selectedNets.length} 個網路）
                              </div>
                              {isPreviewLoading && (
                                <div style={{ position: "absolute", top: 12, right: 16, zIndex: 1, fontSize: 12, color: "#ffd600" }}>
                                  更新預覽中…
                                </div>
                              )}
                              <Preview2D data={simplifiedScene} fitKey={selectedNets.join(',')} />
                            </div>
                          </Allotment.Pane>
                        </Allotment>
                      ) : (
                        <>
                          <div style={{ position: "absolute", top: 12, left: 16, zIndex: 1, fontSize: 12.5, fontWeight: 600, color: "#9fb0c3", pointerEvents: "none" }}>
                            2D Layout 預覽 · 左鍵平移、滾輪縮放 · 右上角切換圖層
                          </div>
                          {isPreviewLoading && (
                            <div style={{ position: "absolute", top: 12, right: 16, zIndex: 1, fontSize: 12, color: "#ffd600" }}>
                              更新預覽中…
                            </div>
                          )}
                          <Preview2D data={scene} fitKey={inputPath} />
                        </>
                      )}
                    </div>
                  </div>
                </Allotment.Pane>
                
                {/* 日誌面板 */}
                <Allotment.Pane preferredSize={200} minSize={100}>
                  <div style={{ paddingTop: 7, height: "100%" }}>
                    <div className="panel" style={{ height: "100%", padding: 14, overflowY: "auto", display: 'flex', flexDirection: 'column' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
                        <h3 className="panel-title" style={{ margin: 0 }}>系統日誌</h3>
                        <button className="btn" style={{ fontSize: 12, padding: '2px 10px' }} onClick={() => setLogs([])}>清除訊息</button>
                      </div>
                      <div ref={logBoxRef} style={{ flex: 1, overflowY: 'auto', fontSize: '12px', fontFamily: '"Cascadia Mono", monospace', color: 'var(--muted)', background: 'rgba(255,255,255,0.5)', padding: '8px', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' }}>
                        {logs.map((l, i) => <div key={i}>{l}</div>)}
                        {logs.length === 0 && <div style={{ color: 'var(--faint)' }}>目前無日誌...</div>}
                      </div>
                    </div>
                  </div>
                </Allotment.Pane>
              </Allotment>
            </div>
          </Allotment.Pane>
        </Allotment>
      </main>
    </div>
  )
}
