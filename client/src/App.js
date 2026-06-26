import { useState, useEffect, useCallback } from 'react';
import {
  ClerkProvider,
  SignedIn,
  SignedOut,
  RedirectToSignIn,
  UserButton,
  useAuth,
} from '@clerk/clerk-react';

const API          = 'https://endearing-blessing-production-c742.up.railway.app';
const PUBLISHABLE_KEY = process.env.REACT_APP_CLERK_PUBLISHABLE_KEY;

const COLS = [
  { key:'new',         label:'New',        color:'#6b7280' },
  { key:'in_progress', label:'In Progress', color:'#BA7517' },
  { key:'resolved',    label:'Complete',    color:'#1D9E75' },
];
const PRI_COLOR = { URGENT:'#E24B4A', HIGH:'#BA7517', MEDIUM:'#378ADD', LOW:'#639922' };
const PRI_ORDER = { URGENT:0, HIGH:1, MEDIUM:2, LOW:3 };
const HOTEL_COLORS = ['#7F77DD','#1D9E75','#378ADD','#BA7517','#E24B4A','#D4537E','#639922'];
const CAT_ICON = { MAINTENANCE:'🔧', GUEST:'🏨', RESERVATIONS:'📅', VENDOR:'📦', STAFF:'👥', ADMIN:'📋', OTHER:'·' };

function hotelColor(name, hotels) {
  const i = hotels.indexOf(name);
  return i >= 0 ? HOTEL_COLORS[i % HOTEL_COLORS.length] : '#888780';
}
function timeAgo(dateStr) {
  if (!dateStr) return '';
  const diff = Date.now() - new Date(dateStr).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function sortByPriority(arr) {
  return [...arr].sort((a,b) => (PRI_ORDER[a.priority]??4) - (PRI_ORDER[b.priority]??4));
}

// ─── Briefing Panel ───────────────────────────────────────────────────────────

function BriefingPanel({ authFetch }) {
  const [briefing, setBriefing]       = useState(null);
  const [loading, setLoading]         = useState(false);
  const [generatedAt, setGeneratedAt] = useState(null);
  const [expanded, setExpanded]       = useState(false);
  const [error, setError]             = useState(null);

  async function generate() {
    setLoading(true); setError(null); setExpanded(true);
    try {
      const res  = await authFetch(`${API}/api/gmail/briefing`);
      if (!res.ok) throw new Error('Failed');
      const data = await res.json();
      setBriefing(data.briefing);
      setGeneratedAt(new Date(data.generatedAt));
    } catch { setError('Failed to generate — try again'); }
    finally { setLoading(false); }
  }

  return (
    <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, marginBottom:20, overflow:'hidden' }}>
      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', padding:'12px 16px', borderBottom: expanded&&briefing ? '1px solid #f3f4f6' : 'none', cursor: briefing ? 'pointer' : 'default' }}
        onClick={() => briefing && setExpanded(e => !e)}>
        <div style={{ display:'flex', alignItems:'center', gap:8 }}>
          <span style={{ fontSize:16 }}>📋</span>
          <span style={{ fontWeight:600, fontSize:14, color:'#111' }}>AI Briefing</span>
          {generatedAt && <span style={{ fontSize:11, color:'#9ca3af' }}>Generated {generatedAt.toLocaleString('en-US', { weekday:'short', hour:'numeric', minute:'2-digit' })}</span>}
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          {briefing && !loading && <button onClick={e=>{e.stopPropagation();generate();}} style={{ fontSize:11, padding:'3px 10px', borderRadius:6, border:'1px solid #e5e7eb', background:'#fff', cursor:'pointer', color:'#6b7280' }}>↺ Refresh</button>}
          <button onClick={e=>{e.stopPropagation(); briefing ? setExpanded(ex=>!ex) : generate();}} disabled={loading}
            style={{ fontSize:12, padding:'6px 14px', borderRadius:8, border:'none', background:'#111', color:'#fff', cursor: loading?'wait':'pointer', opacity: loading?0.7:1 }}>
            {loading ? 'Thinking...' : briefing ? (expanded ? '▲ Hide' : '▼ Show') : 'Generate briefing ↗'}
          </button>
        </div>
      </div>
      {loading && <div style={{ padding:'20px', textAlign:'center', color:'#9ca3af', fontSize:13 }}>Claude is reviewing your inbox...</div>}
      {error && !loading && <div style={{ padding:'10px 16px', color:'#E24B4A', fontSize:12 }}>{error}</div>}
      {expanded && briefing && !loading && (
        <div style={{ padding:'16px 20px' }}>
          <p style={{ margin:'0 0 16px', fontSize:14, color:'#374151', lineHeight:1.6, fontWeight:500 }}>{briefing.headline}</p>
          <div style={{ display:'grid', gridTemplateColumns:'1fr 1fr', gap:14 }}>
            {briefing.urgent?.length > 0 && (
              <div style={{ background:'#fef2f2', borderRadius:8, padding:'12px 14px' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#E24B4A', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8 }}>🚨 Urgent — act now</div>
                {briefing.urgent.map((item,i) => <div key={i} style={{ display:'flex', gap:6, fontSize:12, color:'#991b1b', padding:'2px 0', lineHeight:1.55 }}><span style={{ flexShrink:0, fontWeight:700 }}>→</span>{item}</div>)}
              </div>
            )}
            {briefing.todaysPlan?.length > 0 && (
              <div style={{ background:'#f8fafc', borderRadius:8, padding:'12px 14px' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#374151', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8 }}>📋 Order of attack</div>
                {briefing.todaysPlan.map((item,i) => <div key={i} style={{ fontSize:12, color:'#374151', padding:'2px 0', lineHeight:1.55 }}>{item}</div>)}
              </div>
            )}
            {briefing.watchList?.length > 0 && (
              <div style={{ background:'#fffbeb', borderRadius:8, padding:'12px 14px' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#BA7517', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8 }}>👀 Watch list</div>
                {briefing.watchList.map((item,i) => <div key={i} style={{ display:'flex', gap:6, fontSize:12, color:'#92400e', padding:'2px 0', lineHeight:1.55 }}><span style={{ flexShrink:0 }}>→</span>{item}</div>)}
              </div>
            )}
            {briefing.clear && (
              <div style={{ background:'#f0fdf4', borderRadius:8, padding:'12px 14px' }}>
                <div style={{ fontSize:11, fontWeight:700, color:'#1D9E75', textTransform:'uppercase', letterSpacing:'0.5px', marginBottom:8 }}>✓ Under control</div>
                <div style={{ fontSize:12, color:'#166534', lineHeight:1.55 }}>{briefing.clear}</div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Card ─────────────────────────────────────────────────────────────────────

function Card({ em, hotels, isOpen, onToggle, onStatusChange, onDelete, onDragStart, onDragEnd, isDragging }) {
  const hc = hotelColor(em.hotel, hotels);
  const pc = PRI_COLOR[em.priority] || '#888780';
  const prevStatus = em.status==='in_progress'?'new':em.status==='resolved'?'in_progress':null;
  const nextStatus = em.status==='new'?'in_progress':em.status==='in_progress'?'resolved':null;
  const prevLabel  = em.status==='in_progress'?'← New':em.status==='resolved'?'← In Progress':null;
  const nextLabel  = em.status==='new'?'→ Start':em.status==='in_progress'?'✓ Done':null;
  return (
    <div draggable onDragStart={onDragStart} onDragEnd={onDragEnd}
      style={{ border:'1px solid #e5e7eb', borderLeft:`3px solid ${hc}`, borderRadius:8, background:'#fff', padding:'10px 12px', marginBottom:8, cursor:'grab', opacity:isDragging?0.4:1, userSelect:'none' }}>
      <div style={{ display:'flex', gap:4, marginBottom:6, flexWrap:'wrap' }} onClick={onToggle}>
        <span style={{ fontSize:11, padding:'2px 7px', borderRadius:4, background:pc+'22', color:pc, fontWeight:700 }}>{em.priority}</span>
        <span style={{ fontSize:11, padding:'2px 7px', borderRadius:4, background:hc+'18', color:hc, fontWeight:600 }}>{em.hotel||'Unknown'}</span>
        <span style={{ fontSize:11, padding:'2px 7px', borderRadius:4, background:'#f3f4f6', color:'#6b7280' }}>{CAT_ICON[em.category]||'·'} {em.category}</span>
        {em.requires_response && <span style={{ fontSize:11, padding:'2px 7px', borderRadius:4, background:'#eff6ff', color:'#3b82f6', fontWeight:500 }}>↩ Reply</span>}
      </div>
      <div onClick={onToggle} style={{ fontSize:13, fontWeight:600, color:'#111', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:isOpen?'normal':'nowrap', marginBottom:3, cursor:'pointer' }}>
        {em.subject||'(No subject)'}
      </div>
      <div onClick={onToggle} style={{ fontSize:11, color:'#9ca3af', marginBottom:6 }}>
        {em.sender} · {timeAgo(em.received_at)}
        {em.received_at && <span style={{ marginLeft:4, color:'#d1d5db' }}>({new Date(em.received_at).toLocaleString('en-US',{month:'short',day:'numeric',hour:'numeric',minute:'2-digit'})})</span>}
      </div>
      {!isOpen && em.action_items?.length>0 && <div onClick={onToggle} style={{ fontSize:11, color:'#6b7280', marginBottom:4 }}>→ {em.action_items.length} action item{em.action_items.length>1?'s':''}</div>}
      {isOpen && (
        <div onClick={onToggle} style={{ marginTop:8, paddingTop:8, borderTop:'1px solid #f3f4f6' }}>
          <p style={{ margin:'0 0 8px', fontSize:12, color:'#6b7280', lineHeight:1.65 }}>{em.summary}</p>
          {em.action_items?.map((a,i) => <div key={i} style={{ display:'flex', gap:6, fontSize:12, color:'#374151', padding:'2px 0' }}><span style={{ color:hc, flexShrink:0 }}>→</span>{a}</div>)}
        </div>
      )}
      <div style={{ display:'flex', gap:6, marginTop:8 }}>
        {prevLabel && <button onClick={e=>{e.stopPropagation();onStatusChange(prevStatus);}} style={{ fontSize:11, padding:'3px 10px', borderRadius:6, border:'1px solid #e5e7eb', background:'#f9fafb', cursor:'pointer', color:'#6b7280' }}>{prevLabel}</button>}
        {nextLabel && <button onClick={e=>{e.stopPropagation();onStatusChange(nextStatus);}} style={{ fontSize:11, padding:'3px 10px', borderRadius:6, cursor:'pointer', fontWeight:600, border:nextStatus==='resolved'?'1px solid #1D9E75':'1px solid #e5e7eb', background:nextStatus==='resolved'?'#f0fdf4':'#fff', color:nextStatus==='resolved'?'#1D9E75':'#374151' }}>{nextLabel}</button>}
        {em.status==='resolved' && <button onClick={e=>{e.stopPropagation();onDelete();}} style={{ fontSize:11, padding:'3px 10px', borderRadius:6, border:'1px solid #fecaca', background:'#fef2f2', cursor:'pointer', color:'#E24B4A' }}>Delete</button>}
      </div>
    </div>
  );
}

// ─── Btn ──────────────────────────────────────────────────────────────────────

function Btn({ onClick, disabled, children, primary = false }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button onClick={onClick} disabled={disabled}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      style={{ fontSize:13, padding:'8px 16px', borderRadius:8, display:'flex', alignItems:'center', gap:6,
        border: primary ? 'none' : '1px solid #e5e7eb',
        background: primary ? '#111' : hovered ? '#f3f4f6' : '#fff',
        color: primary ? '#fff' : '#374151',
        cursor: disabled ? 'not-allowed' : 'pointer', fontWeight:500,
        transition:'background 0.12s, border-color 0.12s',
        borderColor: !primary && hovered ? '#d1d5db' : '#e5e7eb',
        opacity: disabled ? 0.6 : 1,
      }}>
      {children}
    </button>
  );
}

// ─── Dashboard (inner — has access to useAuth) ─────────────────────────────────

function Dashboard() {
  const { getToken } = useAuth();

  // authFetch: wraps every API call with Clerk JWT automatically
  const authFetch = useCallback(async (url, options = {}) => {
    const token = await getToken();
    return fetch(url, {
      ...options,
      headers: {
        ...(options.headers || {}),
        'Authorization': `Bearer ${token}`,
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
      },
    });
  }, [getToken]);

  const [emails, setEmails]             = useState([]);
  const [hotels, setHotels]             = useState([]);
  const [gmailConnected, setGmailConnected] = useState(null);
  const [filter, setFilter]             = useState('All');
  const [openId, setOpenId]             = useState(null);
  const [loading, setLoading]           = useState(true);
  const [syncing, setSyncing]           = useState(false);
  const [lastSync, setLastSync]         = useState(null);
  const [showSettings, setShowSettings] = useState(false);
  const [settingsTab, setSettingsTab]   = useState('hotels');
  const [hotelInput, setHotelInput]     = useState('');
  const [reportConfig, setReportConfig] = useState({ recipients:'', morning:true, midday:true, evening:true });
  const [draggingId, setDraggingId]     = useState(null);
  const [dragOverCol, setDragOverCol]   = useState(null);
  const [sortNew, setSortNew]           = useState(false);

  const checkStatus = useCallback(async () => {
    const res  = await authFetch(`${API}/api/gmail/status`);
    const data = await res.json();
    setGmailConnected(data.connected);
  }, [authFetch]);

  const fetchEmails = useCallback(async () => {
    setSyncing(true);
    try {
      const res = await authFetch(`${API}/api/gmail/emails`);
      if (!res.ok) return;
      const data = await res.json();
      setEmails(data);
      setLastSync(new Date());
    } catch(e) { console.error(e); }
    finally { setLoading(false); setSyncing(false); }
  }, [authFetch]);

  const fetchHotels = useCallback(async () => {
    const res = await authFetch(`${API}/api/gmail/hotels`);
    if (!res.ok) return;
    const { hotels: h } = await res.json();
    if (h?.length) setHotels(h);
  }, [authFetch]);

  const fetchReportConfig = useCallback(async () => {
    const res = await authFetch(`${API}/api/gmail/report-config`);
    if (!res.ok) return;
    const data = await res.json();
    setReportConfig({
      recipients: (data.recipient_emails||[]).join('\n'),
      morning: data.send_morning ?? true,
      midday:  data.send_midday  ?? true,
      evening: data.send_evening ?? true,
    });
  }, [authFetch]);

  useEffect(() => {
    checkStatus();
  }, [checkStatus]);

  useEffect(() => {
    if (!gmailConnected) return;
    fetchEmails();
    fetchHotels();
    fetchReportConfig();
    const t = setInterval(fetchEmails, 30000);
    return () => clearInterval(t);
  }, [gmailConnected, fetchEmails, fetchHotels, fetchReportConfig]);

  useEffect(() => { setHotelInput(hotels.join('\n')); }, [hotels]);

  async function connectGmail() {
    try {
      const token = await getToken();
      console.log('[connect] token:', token ? 'GOT TOKEN' : 'NO TOKEN');
      const res = await fetch(`${API}/api/gmail/auth-url`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      console.log('[connect] status:', res.status);
      const data = await res.json();
      console.log('[connect] data:', JSON.stringify(data));
      if (data.url) {
        window.location.href = data.url;
      } else {
        alert('No URL returned: ' + JSON.stringify(data));
      }
    } catch (e) {
      console.error('[connect] Error:', e);
      alert('Error: ' + e.message);
    }
  }

  async function saveHotels(list) {
    await authFetch(`${API}/api/gmail/hotels`, { method:'PUT', body: JSON.stringify({ hotels: list }) });
    setHotels(list);
    setShowSettings(false);
  }

  async function saveReportConfig() {
    await authFetch(`${API}/api/gmail/report-config`, {
      method:'PUT',
      body: JSON.stringify({
        recipient_emails: reportConfig.recipients.split('\n').map(e=>e.trim()).filter(Boolean),
        send_morning: reportConfig.morning,
        send_midday:  reportConfig.midday,
        send_evening: reportConfig.evening,
      }),
    });
    setShowSettings(false);
  }

  async function updateStatus(id, status) {
    await authFetch(`${API}/api/gmail/emails/${id}/status`, { method:'PATCH', body: JSON.stringify({ status }) });
    setEmails(prev => prev.map(e => e.id===id ? {...e,status} : e));
  }

  async function deleteEmail(id) {
    await authFetch(`${API}/api/gmail/emails/${id}`, { method:'DELETE' });
    setEmails(prev => prev.filter(e => e.id!==id));
  }

  async function clearResolved() {
    await authFetch(`${API}/api/gmail/emails`, { method:'DELETE' });
    setEmails(prev => prev.filter(e => e.status!=='resolved'));
  }

  function handleDrop(colKey) {
    if (draggingId) updateStatus(draggingId, colKey);
    setDraggingId(null); setDragOverCol(null);
  }

  const shown     = filter==='All' ? emails : emails.filter(e => e.hotel===filter);
  const urgentN   = emails.filter(e => e.priority==='URGENT').length;
  const replyN    = emails.filter(e => e.requires_response && e.status!=='resolved').length;
  const allHotels = [...new Set([...hotels, ...emails.map(e=>e.hotel).filter(h=>h&&h!=='Unknown')])];

  const tabBtn = (key, label) => (
    <button onClick={() => setSettingsTab(key)} style={{ fontSize:13, padding:'6px 14px', borderRadius:8, border:'none', background: settingsTab===key ? '#111' : '#f3f4f6', color: settingsTab===key ? '#fff' : '#6b7280', cursor:'pointer', fontWeight: settingsTab===key ? 600 : 400 }}>
      {label}
    </button>
  );

  // ─── Gmail not connected yet ───────────────────────────────────────────────

  if (gmailConnected === false) {
    return (
      <div style={{ fontFamily:'system-ui, sans-serif', minHeight:'100vh', background:'#f9fafb', display:'flex', alignItems:'center', justifyContent:'center' }}>
        <div style={{ textAlign:'center', padding:40 }}>
          <div style={{ fontSize:48, marginBottom:16 }}>📬</div>
          <h1 style={{ fontSize:24, fontWeight:700, margin:'0 0 8px' }}>Welcome to Dashboard</h1>
          <p style={{ color:'#6b7280', marginBottom:24, maxWidth:360, lineHeight:1.6 }}>
            Connect your Gmail to start receiving real-time email triage and AI-powered briefings.
          </p>
          <button onClick={connectGmail} style={{ fontSize:14, padding:'12px 24px', borderRadius:10, border:'none', background:'#111', color:'#fff', cursor:'pointer', fontWeight:600 }}>
            Connect Gmail →
          </button>
        </div>
      </div>
    );
  }

  // ─── Main dashboard ────────────────────────────────────────────────────────

  return (
    <div style={{ fontFamily:'system-ui, sans-serif', background:'#f9fafb', minHeight:'100vh', padding:20, boxSizing:'border-box' }}>
      <style>{`
        @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        .spin { display:inline-block; animation:spin 0.8s linear infinite; }
        ::-webkit-scrollbar { width:4px; }
        ::-webkit-scrollbar-track { background:transparent; }
        ::-webkit-scrollbar-thumb { background:#e5e7eb; border-radius:4px; }
        select { appearance:none; -webkit-appearance:none; }
      `}</style>

      {/* Header */}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:20 }}>
        <div>
          <h1 style={{ margin:0, fontSize:20, fontWeight:700 }}>Dashboard</h1>
          <div style={{ fontSize:12, color: syncing ? '#BA7517' : '#9ca3af', marginTop:2 }}>
            {syncing ? '⟳ Syncing...' : lastSync ? `Last sync ${timeAgo(lastSync)}` : 'Loading...'}
          </div>
        </div>
        <div style={{ display:'flex', gap:8, alignItems:'center' }}>
          <Btn onClick={() => { setShowSettings(true); setSettingsTab('hotels'); }}>
            ⚙️ Settings
          </Btn>
          <Btn onClick={fetchEmails} disabled={syncing}>
            <span className={syncing ? 'spin' : ''} style={{ fontSize:16 }}>🔄</span>
            {syncing ? 'Syncing' : 'Refresh'}
          </Btn>
          {/* Clerk user button — avatar + sign out */}
          <UserButton afterSignOutUrl="/" />
        </div>
      </div>

      {/* Stats */}
      <div style={{ display:'grid', gridTemplateColumns:'repeat(4, 1fr)', gap:12, marginBottom:20 }}>
        {[
          { label:'Total',          value:emails.length,        bg:'#f3f4f6', color:'#111'    },
          { label:'Urgent',         value:urgentN,              bg:'#fef2f2', color:'#E24B4A' },
          { label:'Replies needed', value:replyN,               bg:'#eff6ff', color:'#3b82f6' },
          { label:'Properties',     value:hotels.length||'—',   bg:'#f3f4f6', color:'#111'    },
        ].map(s => (
          <div key={s.label} style={{ background:s.bg, borderRadius:10, padding:'12px 16px' }}>
            <div style={{ fontSize:11, color:s.color, opacity:0.7, marginBottom:2 }}>{s.label}</div>
            <div style={{ fontSize:24, fontWeight:700, color:s.color }}>{s.value}</div>
          </div>
        ))}
      </div>

      <BriefingPanel authFetch={authFetch} />

      {/* Hotel filter — dropdown */}
      <div style={{ display:'flex', alignItems:'center', gap:10, marginBottom:20 }}>
        <label style={{ fontSize:12, color:'#6b7280', fontWeight:500, flexShrink:0 }}>Filter by property:</label>
        <div style={{ position:'relative' }}>
          <select value={filter} onChange={e => setFilter(e.target.value)}
            style={{ fontSize:13, padding:'7px 32px 7px 12px', borderRadius:8, border:'1px solid #e5e7eb', background:'#fff', color:'#374151', cursor:'pointer', outline:'none', fontFamily:'system-ui', minWidth:220 }}>
            <option value="All">All ({emails.length})</option>
            {allHotels.map(h => <option key={h} value={h}>{h} ({emails.filter(e=>e.hotel===h).length})</option>)}
          </select>
          <span style={{ position:'absolute', right:10, top:'50%', transform:'translateY(-50%)', pointerEvents:'none', color:'#9ca3af', fontSize:14 }}>▾</span>
        </div>
        {filter !== 'All' && <button onClick={() => setFilter('All')} style={{ fontSize:12, color:'#9ca3af', background:'none', border:'none', cursor:'pointer', padding:0 }}>× Clear</button>}
      </div>

      {/* Kanban */}
      {loading ? (
        <div style={{ textAlign:'center', padding:60, color:'#9ca3af' }}>Loading emails...</div>
      ) : (
        <div style={{ display:'grid', gridTemplateColumns:'repeat(3, minmax(0, 1fr))', gap:16, alignItems:'flex-start' }}>
          {COLS.map(col => {
            const rawCards = shown.filter(e => e.status===col.key);
            const cards    = col.key==='new' && sortNew ? sortByPriority(rawCards) : rawCards;
            const isOver   = dragOverCol===col.key;
            return (
              <div key={col.key}
                onDragOver={e=>{e.preventDefault();setDragOverCol(col.key);}}
                onDragLeave={()=>setDragOverCol(null)}
                onDrop={()=>handleDrop(col.key)}
                style={{ background:isOver?col.color+'08':'transparent', borderRadius:10, border:isOver?`2px dashed ${col.color}`:'2px solid transparent', padding:isOver?6:0, transition:'all 0.15s' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', paddingBottom:10, borderBottom:`2px solid ${col.color}`, marginBottom:12, paddingTop:2 }}>
                  <span style={{ fontSize:13, fontWeight:600, color:col.color }}>{col.label}</span>
                  <div style={{ display:'flex', alignItems:'center', gap:6 }}>
                    <span style={{ fontSize:11, padding:'1px 8px', borderRadius:999, background:col.color+'22', color:col.color, fontWeight:600 }}>{cards.length}</span>
                    {col.key==='new' && (
                      <button onClick={()=>setSortNew(s=>!s)} style={{ fontSize:11, padding:'2px 8px', borderRadius:6, cursor:'pointer', border:`1px solid ${sortNew?'#6b7280':'#e5e7eb'}`, background:sortNew?'#6b7280':'#fff', color:sortNew?'#fff':'#6b7280', transition:'all 0.12s' }}>
                        {sortNew?'↕ Priority':'↕ Sort'}
                      </button>
                    )}
                    {col.key==='resolved' && cards.length>0 && (
                      <button onClick={clearResolved} style={{ fontSize:11, padding:'2px 8px', borderRadius:6, border:'1px solid #fecaca', background:'#fef2f2', color:'#E24B4A', cursor:'pointer' }}>Clear all</button>
                    )}
                  </div>
                </div>
                <div style={{ maxHeight:'calc(100vh - 420px)', overflowY:'auto', paddingRight:2 }}>
                  {cards.length===0
                    ? <div style={{ fontSize:12, color:'#d1d5db', textAlign:'center', padding:'30px 0' }}>—</div>
                    : cards.map(em => (
                        <Card key={em.id} em={em} hotels={allHotels}
                          isOpen={openId===em.id}
                          onToggle={()=>setOpenId(openId===em.id?null:em.id)}
                          onStatusChange={s=>updateStatus(em.id,s)}
                          onDelete={()=>deleteEmail(em.id)}
                          onDragStart={()=>setDraggingId(em.id)}
                          onDragEnd={()=>{setDraggingId(null);setDragOverCol(null);}}
                          isDragging={draggingId===em.id}
                        />
                      ))
                  }
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Settings modal */}
      {showSettings && (
        <div style={{ position:'fixed', inset:0, background:'rgba(0,0,0,0.4)', display:'flex', alignItems:'center', justifyContent:'center', zIndex:100 }}>
          <div style={{ background:'#fff', borderRadius:12, padding:24, width:460, maxHeight:'80vh', overflowY:'auto' }}>
            <div style={{ display:'flex', gap:8, marginBottom:18 }}>
              {tabBtn('hotels','🏨 Hotels')}
              {tabBtn('reports','📧 Reports')}
            </div>
            {settingsTab==='hotels' && (
              <>
                <p style={{ fontSize:13, color:'#6b7280', margin:'0 0 10px' }}>One hotel name per line. Claude uses these to classify which property each email belongs to.</p>
                <textarea rows={8} value={hotelInput} onChange={e=>setHotelInput(e.target.value)}
                  placeholder={'Courtyard by Marriott, Connecticut\nResidence Inn, Boston\n...'}
                  style={{ width:'100%', fontSize:13, padding:10, borderRadius:8, border:'1px solid #e5e7eb', resize:'vertical', boxSizing:'border-box', fontFamily:'system-ui' }}
                />
                <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
                  <button onClick={()=>setShowSettings(false)} style={{ fontSize:13, padding:'6px 14px', borderRadius:8, border:'1px solid #e5e7eb', background:'#fff', cursor:'pointer' }}>Cancel</button>
                  <button onClick={()=>saveHotels(hotelInput.split('\n').map(h=>h.trim()).filter(Boolean))} style={{ fontSize:13, padding:'6px 14px', borderRadius:8, border:'none', background:'#111', color:'#fff', cursor:'pointer' }}>Save</button>
                </div>
              </>
            )}
            {settingsTab==='reports' && (
              <>
                <p style={{ fontSize:13, color:'#6b7280', margin:'0 0 10px' }}>Recipient emails (one per line). These people will receive scheduled briefings.</p>
                <textarea rows={4} value={reportConfig.recipients} onChange={e=>setReportConfig(c=>({...c,recipients:e.target.value}))}
                  placeholder={'boss@company.com\nmanager@company.com'}
                  style={{ width:'100%', fontSize:13, padding:10, borderRadius:8, border:'1px solid #e5e7eb', resize:'vertical', boxSizing:'border-box', fontFamily:'system-ui', marginBottom:14 }}
                />
                <div style={{ fontSize:13, fontWeight:600, color:'#111', marginBottom:10 }}>Send reports at:</div>
                {[{key:'morning',label:'🌅 Morning (7am)'},{key:'midday',label:'☀️ Midday (12pm)'},{key:'evening',label:'🌆 Evening (6pm)'}].map(({ key, label }) => (
                  <label key={key} style={{ display:'flex', alignItems:'center', gap:10, marginBottom:10, cursor:'pointer' }}>
                    <input type="checkbox" checked={reportConfig[key]} onChange={e=>setReportConfig(c=>({...c,[key]:e.target.checked}))} style={{ width:16, height:16, cursor:'pointer' }} />
                    <span style={{ fontSize:13, color:'#374151' }}>{label}</span>
                  </label>
                ))}
                <div style={{ display:'flex', gap:8, justifyContent:'flex-end', marginTop:12 }}>
                  <button onClick={()=>setShowSettings(false)} style={{ fontSize:13, padding:'6px 14px', borderRadius:8, border:'1px solid #e5e7eb', background:'#fff', cursor:'pointer' }}>Cancel</button>
                  <button onClick={saveReportConfig} style={{ fontSize:13, padding:'6px 14px', borderRadius:8, border:'none', background:'#111', color:'#fff', cursor:'pointer' }}>Save</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ─── App — Clerk wrapper ───────────────────────────────────────────────────────

export default function App() {
  return (
    <ClerkProvider publishableKey={PUBLISHABLE_KEY}>
      <SignedIn>
        <Dashboard />
      </SignedIn>
      <SignedOut>
        <RedirectToSignIn />
      </SignedOut>
    </ClerkProvider>
  );
}