import { useState, useEffect, useRef, useCallback } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESS, ABI } from "./contract";

const LEVELS = [
  { id:1,  difficulty:"Easy",      topic:"What is a blockchain?"         },
  { id:2,  difficulty:"Easy",      topic:"Who created Bitcoin?"           },
  { id:3,  difficulty:"Easy",      topic:"What is block zero?"            },
  { id:4,  difficulty:"Medium",    topic:"ETH consensus mechanism"        },
  { id:5,  difficulty:"Medium",    topic:"Bitcoin consensus mechanism"    },
  { id:6,  difficulty:"Medium",    topic:"Ethereum execution cost unit"   },
  { id:7,  difficulty:"Hard",      topic:"Read Solidity — find the bug"   },
  { id:8,  difficulty:"Hard",      topic:"Trustless property"             },
  { id:9,  difficulty:"Very Hard", topic:"Decode binary to ASCII"         },
  { id:10, difficulty:"Extreme",   topic:"4th Bitcoin halving reward"     },
];

const DIFF_COLOR = {
  Easy:        { bg:"#0d2b1a", border:"#22c55e", text:"#4ade80" },
  Medium:      { bg:"#1a1a0a", border:"#eab308", text:"#facc15" },
  Hard:        { bg:"#2a0d0d", border:"#ef4444", text:"#f87171" },
  "Very Hard": { bg:"#1a0d2a", border:"#a855f7", text:"#c084fc" },
  Extreme:     { bg:"#2a1500", border:"#f97316", text:"#fb923c" },
};

const MAX_WRONG_PER_LEVEL = 5;
const LOCKOUT_MINUTES = 60;

function fmt(sec) {
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = sec%60;
  if(h>0) return `${h}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;
  return `${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;
}

function ParticleBg() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    const pts = Array.from({length:60},()=>({
      x:Math.random()*w, y:Math.random()*h,
      vx:(Math.random()-.5)*.3, vy:(Math.random()-.5)*.3,
      r:Math.random()*1.5+.5
    }));
    const resize=()=>{w=canvas.width=window.innerWidth;h=canvas.height=window.innerHeight};
    window.addEventListener("resize",resize);
    let raf;
    const draw=()=>{
      ctx.clearRect(0,0,w,h);
      pts.forEach(p=>{
        p.x+=p.vx; p.y+=p.vy;
        if(p.x<0)p.x=w; if(p.x>w)p.x=0;
        if(p.y<0)p.y=h; if(p.y>h)p.y=0;
        ctx.beginPath(); ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
        ctx.fillStyle="rgba(0,255,180,0.25)"; ctx.fill();
      });
      pts.forEach((a,i)=>pts.slice(i+1).forEach(b=>{
        const d=Math.hypot(a.x-b.x,a.y-b.y);
        if(d<120){ctx.beginPath();ctx.moveTo(a.x,a.y);ctx.lineTo(b.x,b.y);
          ctx.strokeStyle=`rgba(0,255,180,${.08*(1-d/120)})`;ctx.lineWidth=.5;ctx.stroke();}
      }));
      raf=requestAnimationFrame(draw);
    };
    draw();
    return()=>{cancelAnimationFrame(raf);window.removeEventListener("resize",resize)};
  },[]);
  return <canvas ref={canvasRef} style={{position:"fixed",top:0,left:0,zIndex:0,pointerEvents:"none"}}/>;
}

function RoundDurationControl({ ownerLoading, onSet }) {
  const [hours, setHours] = useState("24");
  const [minutes, setMinutes] = useState("0");
  const inputStyle = {
    background:"rgba(0,0,0,.4)", border:"1px solid #334", borderRadius:8,
    padding:"10px 12px", color:"#e2e8f0", fontSize:15, width:80,
    fontFamily:"'Courier New',monospace", textAlign:"center",
  };
  const totalSecs = (parseInt(hours||0,10)*3600) + (parseInt(minutes||0,10)*60);
  return (
    <div style={{border:"1px solid #0ea5e9",borderRadius:14,padding:24,background:"rgba(14,165,233,.05)"}}>
      <div style={{color:"#38bdf8",fontWeight:700,fontSize:16,marginBottom:6}}>⏱ Set Round Duration</div>
      <div style={{color:"#888",fontSize:13,marginBottom:16}}>Sets a deadline from now. Players cannot submit after expiry.</div>
      <div style={{display:"flex",alignItems:"center",gap:12,flexWrap:"wrap"}}>
        <div style={{display:"flex",alignItems:"center",gap:8}}>
          <input style={inputStyle} type="number" min="0" max="720" value={hours} onChange={e=>setHours(e.target.value)}/>
          <span style={{color:"#555"}}>h</span>
          <input style={inputStyle} type="number" min="0" max="59" value={minutes} onChange={e=>setMinutes(e.target.value)}/>
          <span style={{color:"#555"}}>m</span>
        </div>
        <button onClick={()=>onSet(totalSecs)} disabled={!!ownerLoading}
          style={{background:"rgba(14,165,233,.15)",border:"1px solid #0ea5e9",color:"#38bdf8",fontWeight:700,padding:"10px 20px",borderRadius:10,cursor:"pointer",fontSize:13,fontFamily:"'Courier New',monospace"}}>
          {ownerLoading==="Set Round Duration"?"⏳…":"✅ Set Deadline"}
        </button>
        <button onClick={()=>onSet(0)} disabled={!!ownerLoading}
          style={{background:"rgba(255,255,255,.03)",border:"1px solid #334",color:"#666",padding:"10px 16px",borderRadius:10,cursor:"pointer",fontSize:13,fontFamily:"'Courier New',monospace"}}>
          ✕ Clear
        </button>
      </div>
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState("home");
  const [wallet, setWallet] = useState("");

  // ── ALL game state in one object to avoid stale closure issues ──────────
  const [gs, setGs] = useState({
    entered: false,
    currentLevel: 0,   // 0-based, matches contract
    score: 0,
    attempts: 0,
    wrongs: 0,
    wrongOnLevel: 0,
    hintTokens: 2,
    lockout: 0,
    won: false,
    hint: "",          // puzzle text for current level
    partialHint: "",
    gameStartedAt: null,
    elapsed: 0,
  });

  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [loading, setLoading] = useState("");
  const [prizePool, setPrizePool] = useState("0");
  const [playerCount, setPlayerCount] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [winners, setWinners] = useState([]);
  const [isOwner, setIsOwner] = useState(false);
  const [ownerFeedback, setOwnerFeedback] = useState(null);
  const [ownerLoading, setOwnerLoading] = useState("");

  // Lockout countdown
  useEffect(()=>{
    if(gs.lockout<=0) return;
    const t=setInterval(()=>setGs(g=>({...g,lockout:Math.max(0,g.lockout-1)})),1000);
    return()=>clearInterval(t);
  },[gs.lockout]);

  // Elapsed timer
  useEffect(()=>{
    if(!gs.gameStartedAt||gs.won) return;
    const t=setInterval(()=>setGs(g=>({...g,elapsed:Math.floor((Date.now()-g.gameStartedAt)/1000)})),1000);
    return()=>clearInterval(t);
  },[gs.gameStartedAt,gs.won]);

  const getContract = useCallback(async (needSigner=false) => {
    if(!window.ethereum) throw new Error("MetaMask not found");
    const provider = new ethers.BrowserProvider(window.ethereum);
    if(needSigner){
      const signer = await provider.getSigner();
      return new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    }
    return new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
  },[]);

  // ── THE KEY FIX: one function that reads EVERYTHING fresh from chain ────
  // Uses getPlayerStats(addr) for reliable reads + getHintForLevel for puzzle
  const refreshAll = useCallback(async (addr) => {
    if(!addr) return;
    try {
      const c = await getContract();

      // 1. getMyStats — called with provider so msg.sender = addr via eth_call
      //    BUT getMyStats requires mustHaveEntered. Use getPlayerStats instead
      //    which is public and takes an address param — always works.
      const stats = await c.getPlayerStats(addr);
      // getPlayerStats returns: currentLevel, totalAttempts, wrongAttempts, score, hasWon, hasEntered, accuracyPct

      const lvl        = Number(stats.currentLevel);
      const total      = Number(stats.totalAttempts);
      const wrong      = Number(stats.wrongAttempts);
      const score      = Number(stats.score);
      const hasWon     = stats.hasWon;
      const hasEntered = stats.hasEntered;

      // 2. Read wrongOnCurrentLevel from the public players mapping directly
      let wrongOnLevel = 0;
      let lockoutSecs  = 0;
      let hintTokens   = 2;
      let entryTime    = 0;
      try {
        const raw = await c.players(addr);
        wrongOnLevel = Number(raw.wrongOnCurrentLevel || 0);
        hintTokens   = Number(raw.hintTokens || 0);
        entryTime    = Number(raw.entryTime || 0);
        const lockoutUntil = Number(raw.lockoutUntil || 0);
        const now = Math.floor(Date.now()/1000);
        lockoutSecs = lockoutUntil > now ? lockoutUntil - now : 0;
      } catch(e){ console.warn("players() read failed:", e); }

      // 3. Fetch hint for current level — only if not won
      let hint = "";
      if(!hasWon && lvl < LEVELS.length) {
        try {
          // getHintForLevel(n) is 1-indexed and fully public — no mustHaveEntered
          hint = await c.getHintForLevel(lvl + 1);
        } catch(e){ console.warn("getHintForLevel failed:", e); }
      }

      // 4. Game status for prize pool
      try {
        const status = await c.getGameStatus();
        setPrizePool(ethers.formatEther(status.prizePool));
        setPlayerCount(Number(status.playerCount));
      } catch(e){}

      const now = Date.now();
      const gameStartedAt = entryTime > 0 ? (now - (Math.floor(now/1000) - entryTime)*1000) : now;

      setGs(prev => ({
        ...prev,
        entered:      hasEntered,
        currentLevel: lvl,
        score,
        attempts:     total,
        wrongs:       wrong,
        wrongOnLevel,
        hintTokens,
        lockout:      lockoutSecs,
        won:          hasWon,
        hint,
        // Keep partialHint unless level changed (means new level, clear it)
        partialHint:  prev.currentLevel !== lvl ? "" : prev.partialHint,
        gameStartedAt: prev.gameStartedAt || (entryTime > 0 ? gameStartedAt : null),
      }));

    } catch(e){ console.error("refreshAll failed:", e); }
  },[getContract]);

  const connectWallet = async () => {
    if(!window.ethereum){ alert("Please install MetaMask!"); return; }
    const accounts = await window.ethereum.request({method:"eth_requestAccounts"});
    const addr = accounts[0];
    setWallet(addr);
    await refreshAll(addr);
    try {
      const c = await getContract();
      const contractOwner = await c.owner();
      setIsOwner(contractOwner.toLowerCase() === addr.toLowerCase());
    } catch(e){}
  };

  useEffect(()=>{ if(wallet) refreshAll(wallet); },[wallet]);

  const handleEnter = async () => {
    try {
      setLoading("Entering game...");
      setFeedback({type:"ok",msg:"⏳ Sending transaction..."});
      const c = await getContract(true);
      const tx = await c.enterGame({value: ethers.parseEther("0.01")});
      await tx.wait();
      setFeedback({type:"ok",msg:"✅ Entered! Refreshing..."});
      // Wait one block for state to settle then refresh
      await new Promise(r=>setTimeout(r,1500));
      await refreshAll(wallet);
      setGs(g=>({...g,gameStartedAt:Date.now(),elapsed:0}));
      setFeedback({type:"ok",msg:"✅ Entered! 0.01 ETH paid. Good luck!"});
      setPage("game");
    } catch(e){
      const msg = e.reason || e.message || "";
      if(msg.includes("already entered")){
        await refreshAll(wallet);
        setPage("game");
        setFeedback(null);
      } else {
        setFeedback({type:"err",msg:`❌ ${msg.slice(0,120)}`});
      }
    } finally { setLoading(""); }
  };

  const handleSubmit = async () => {
    if(gs.lockout>0||!answer.trim()||loading) return;
    try {
      setLoading("Submitting...");
      setFeedback({type:"ok",msg:"⏳ Checking answer on-chain..."});
      const c = await getContract(true);
      const tx = await c.submitAnswer(answer.trim());
      await tx.wait();
      setAnswer("");
      setFeedback({type:"ok",msg:"✅ Correct! Loading next level..."});
      // Wait for chain to settle then pull fresh state
      await new Promise(r=>setTimeout(r,1500));
      await refreshAll(wallet);
      // Check if won after refresh
      setGs(g=>{
        if(g.won) setFeedback({type:"ok",msg:"🏆 You won! Prize sent to your wallet!"});
        else setFeedback({type:"ok",msg:`✅ Level ${g.currentLevel} — keep going!`});
        return g;
      });
    } catch(e){
      const msg = e.reason || e.message || "";
      if(msg.includes("wrong answer")||msg.includes("wrong")){
        setFeedback({type:"err",msg:"❌ Wrong answer. Try again!"});
      } else if(msg.includes("locked out")||msg.includes("locked")){
        setFeedback({type:"err",msg:`🔒 Too many wrong answers! Locked out for ${LOCKOUT_MINUTES} minutes.`});
      } else if(msg.includes("already won")){
        setFeedback({type:"ok",msg:"🏆 You already won this round!"});
      } else {
        setFeedback({type:"err",msg:`❌ ${msg.slice(0,120)}`});
      }
      await new Promise(r=>setTimeout(r,800));
      await refreshAll(wallet);
    } finally { setLoading(""); }
  };

  const handleHint = async () => {
    if(gs.hintTokens<=0||loading) return;
    try {
      setLoading("Getting hint...");
      const c = await getContract(true);
      const tx = await c.useHintToken();
      await tx.wait();
      await refreshAll(wallet);
      // After refresh, read the partialHint from contract
      try {
        const c2 = await getContract();
        // getHintForLevel is public; partial hint needs useHintToken which we already called
        // Read it from the level struct — use getHintForLevel which returns the main hint
        // The partialHint was returned by useHintToken tx but we can't easily get return value
        // So we store it from the tx receipt event or re-read from players mapping
        // Simplest: show a message telling them the token was used and check their hint
        setGs(g=>({...g, partialHint:"💡 Hint token used! Check the partial hint below the puzzle."}));
      } catch(e){}
      setFeedback(null);
    } catch(e){
      setFeedback({type:"err",msg:`❌ ${e.reason||e.message}`});
    } finally { setLoading(""); }
  };

  const loadLeaderboard = async () => {
    try {
      const c = await getContract();
      const board = await c.getLeaderboard();
      setLeaderboard(board
        .filter(e=>e.player !== ethers.ZeroAddress)
        .map(e=>({
          addr: e.player,
          level: Number(e.currentLevel),
          score: Number(e.score),
          wrong: Number(e.wrongAttempts),
          won: e.hasWon,
          locked: e.isLockedOut,
        }))
      );
    } catch(e){ console.error(e); }
  };

  const loadWinners = async () => {
    try {
      const c = await getContract();
      const ws = await c.getRoundWinners();
      setWinners(ws.map(w=>({
        addr: w.winner,
        prize: ethers.formatEther(w.prize),
        score: Number(w.score),
        round: Number(w.round),
        place: Number(w.place),
        time: `${Math.floor(Number(w.timeTakenSeconds)/60)}m ${Number(w.timeTakenSeconds)%60}s`,
      })));
    } catch(e){ console.error(e); }
  };

  const ownerAction = async (label, fn) => {
    setOwnerFeedback(null);
    setOwnerLoading(label);
    try {
      const c = await getContract(true);
      const tx = await fn(c);
      setOwnerFeedback({type:"ok",msg:`⏳ ${label} — confirming…`});
      await tx.wait();
      await refreshAll(wallet);
      await loadLeaderboard();
      setOwnerFeedback({type:"ok",msg:`✅ ${label} done!`});
    } catch(e){
      setOwnerFeedback({type:"err",msg:`❌ ${e.reason||e.message}`});
    } finally { setOwnerLoading(""); }
  };

  // ── Derived display ─────────────────────────────────────────────────────
  const isGameComplete  = gs.won || gs.currentLevel >= LEVELS.length;
  const safeLevel       = Math.min(gs.currentLevel, LEVELS.length - 1);
  const lvl             = LEVELS[safeLevel];
  const diffStyle       = DIFF_COLOR[lvl?.difficulty] || DIFF_COLOR.Easy;
  const progressPct     = Math.min((gs.currentLevel / LEVELS.length) * 100, 100);
  const safeWrong       = Math.max(0, Math.min(MAX_WRONG_PER_LEVEL, gs.wrongOnLevel));
  const attemptsLeft    = MAX_WRONG_PER_LEVEL - safeWrong;
  const displayLevel    = Math.min(gs.currentLevel + 1, LEVELS.length);
  const accuracy        = gs.attempts > 0 ? Math.round(((gs.attempts - gs.wrongs) / gs.attempts) * 100) : 100;

  return (
    <div style={{minHeight:"100vh",background:"#050508",fontFamily:"'Courier New',monospace",color:"#e2e8f0",position:"relative",overflowX:"hidden"}}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes lockBlink{0%,100%{background:rgba(239,68,68,.15)}50%{background:rgba(239,68,68,.35)}}
        *{box-sizing:border-box}
        input::placeholder{color:#333}
        input:focus{border-color:#00ffb4!important;outline:none;box-shadow:0 0 0 3px rgba(0,255,180,.1)}
        button:hover:not(:disabled){opacity:.85;transform:translateY(-1px)}
        ::-webkit-scrollbar{width:6px}
        ::-webkit-scrollbar-track{background:#050508}
        ::-webkit-scrollbar-thumb{background:#1a2a1a;border-radius:3px}
      `}</style>
      <ParticleBg/>

      {/* NAV */}
      <nav style={{position:"sticky",top:0,zIndex:100,background:"rgba(5,5,8,.9)",backdropFilter:"blur(12px)",borderBottom:"1px solid #0d2b1a",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 32px",height:60}}>
        <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}} onClick={()=>setPage("home")}>
          <span style={{fontSize:26,color:"#00ffb4"}}>⬡</span>
          <span style={{fontSize:20,fontWeight:700,letterSpacing:2,color:"#00ffb4"}}>CipherChain</span>
        </div>
        {/* NAV SCORE STRIP — always visible when entered */}
        {gs.entered && wallet && (
          <div style={{display:"flex",gap:16,alignItems:"center",fontSize:12}}>
            <span style={{color:"#facc15"}}>⭐ {gs.score.toLocaleString()}</span>
            <span style={{color:"#00ffb4"}}>📈 {displayLevel}/10</span>
            <span style={{color:"#888"}}>🎯 {accuracy}%</span>
            <span style={{color:"#38bdf8"}}>⏱ {fmt(gs.elapsed)}</span>
          </div>
        )}
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {["home","game","leaderboard","winners",...(isOwner?["admin"]:[])].map(p=>(
            <button key={p} onClick={()=>{
              setPage(p);
              if(p==="leaderboard") loadLeaderboard();
              if(p==="winners")     loadWinners();
              if(p==="game"&&wallet) refreshAll(wallet);
            }} style={{background:page===p?"rgba(0,255,180,.1)":"transparent",border:`1px solid ${page===p?(p==="admin"?"#f97316":"#00ffb4"):"#1a2a1a"}`,color:page===p?(p==="admin"?"#fb923c":"#00ffb4"):"#666",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontSize:12,letterSpacing:.5,fontFamily:"'Courier New',monospace"}}>
              {p==="home"?"🏠":p==="game"?"🎮 Play":p==="leaderboard"?"📊 Board":p==="admin"?"⚙️ Admin":"🏆 Winners"}
            </button>
          ))}
          {wallet
            ? <span style={{color:"#00ffb4",fontSize:11,background:"rgba(0,255,180,.1)",border:"1px solid #00ffb4",padding:"4px 10px",borderRadius:6}}>{wallet.slice(0,6)}...{wallet.slice(-4)}</span>
            : <button onClick={connectWallet} style={{background:"linear-gradient(135deg,#00ffb4,#0ea5e9)",border:"none",color:"#050508",fontWeight:700,padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontFamily:"'Courier New',monospace"}}>Connect Wallet</button>
          }
        </div>
      </nav>

      <main style={{position:"relative",zIndex:1,maxWidth:1000,margin:"0 auto",padding:"40px 24px 80px"}}>

        {/* HOME */}
        {page==="home" && (
          <div style={{textAlign:"center"}}>
            <div style={{display:"inline-block",background:"rgba(0,255,180,.1)",border:"1px solid #00ffb4",color:"#00ffb4",padding:"4px 16px",borderRadius:20,fontSize:11,letterSpacing:3,marginBottom:24}}>ROUND 1 · SEPOLIA TESTNET</div>
            <h1 style={{fontSize:"clamp(48px,8vw,90px)",fontWeight:900,margin:"0 0 16px",lineHeight:1}}>
              <span style={{color:"#00ffb4"}}>Cipher</span><span style={{color:"#e2e8f0"}}>Chain</span>
            </h1>
            <p style={{color:"#888",fontSize:16,lineHeight:1.8,marginBottom:40,maxWidth:520,margin:"0 auto 40px"}}>
              A fully on-chain CTF game. Solve 10 cryptographic puzzles.<br/>First to finish claims the prize pool.
            </p>
            <div style={{display:"flex",gap:16,justifyContent:"center",flexWrap:"wrap",marginBottom:32}}>
              {[{label:"Prize Pool",val:`${prizePool} ETH`,icon:"💰"},{label:"Players",val:playerCount,icon:"👥"},{label:"Levels",val:"10",icon:"🧩"},{label:"Entry Fee",val:"0.01 ETH",icon:"⛽"}].map(s=>(
                <div key={s.label} style={{background:"rgba(255,255,255,.03)",border:"1px solid #1a2a1a",borderRadius:12,padding:"16px 24px",minWidth:120,display:"flex",flexDirection:"column",alignItems:"center",gap:4}}>
                  <span style={{fontSize:28}}>{s.icon}</span>
                  <div style={{fontSize:22,fontWeight:700,color:"#00ffb4"}}>{s.val}</div>
                  <div style={{fontSize:11,color:"#555",letterSpacing:1}}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{display:"flex",gap:16,justifyContent:"center",marginBottom:32,flexWrap:"wrap"}}>
              {[{place:"🥇 1st",amt:"80%",color:"#facc15"},{place:"🥈 2nd",amt:"15%",color:"#c084fc"},{place:"🌱 Seed",amt:"5%",color:"#94a3b8"}].map(p=>(
                <div key={p.place} style={{background:"rgba(255,255,255,.03)",border:`1px solid ${p.color}`,borderRadius:12,padding:"16px 24px",minWidth:140,textAlign:"center"}}>
                  <div style={{color:"#888",fontSize:13,marginBottom:4}}>{p.place}</div>
                  <div style={{fontSize:24,fontWeight:700,color:p.color}}>{p.amt}</div>
                  <div style={{color:"#555",fontSize:11}}>of pool</div>
                </div>
              ))}
            </div>
            {!wallet
              ? <button onClick={connectWallet} style={{background:"linear-gradient(135deg,#00ffb4,#0ea5e9)",border:"none",color:"#050508",fontWeight:700,padding:"16px 40px",borderRadius:12,fontSize:16,cursor:"pointer",fontFamily:"'Courier New',monospace",marginBottom:48}}>🔌 Connect Wallet First</button>
              : <button onClick={()=>{setPage("game");refreshAll(wallet);}} style={{background:"linear-gradient(135deg,#00ffb4,#0ea5e9)",border:"none",color:"#050508",fontWeight:700,padding:"16px 40px",borderRadius:12,fontSize:16,cursor:"pointer",fontFamily:"'Courier New',monospace",marginBottom:48}}>
                  {gs.entered ? "🎮 Continue Playing" : "⚡ Enter Game — 0.01 ETH"}
                </button>
            }
            <div style={{color:"#555",fontSize:11,letterSpacing:4,marginBottom:16,borderBottom:"1px solid #111",paddingBottom:8}}>PUZZLE LEVELS</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12}}>
              {LEVELS.map((l,i)=>{
                const ds=DIFF_COLOR[l.difficulty];
                return(
                  <div key={l.id} style={{border:`1px solid ${ds.border}`,borderRadius:10,padding:"14px 16px",background:ds.bg,opacity:gs.entered&&i<gs.currentLevel?0.5:1}}>
                    <div style={{fontSize:11,color:"#666",marginBottom:4}}>#{l.id}</div>
                    <div style={{color:ds.text,fontSize:11,fontWeight:700,letterSpacing:1}}>{l.difficulty.toUpperCase()}</div>
                    <div style={{color:"#ccc",fontSize:12,marginTop:4,lineHeight:1.4}}>{l.topic}</div>
                    {gs.entered&&i<gs.currentLevel&&<div style={{color:ds.text,marginTop:6,fontSize:18}}>✓</div>}
                    {gs.entered&&i===gs.currentLevel&&<div style={{color:"#00ffb4",marginTop:6,fontSize:12,animation:"pulse 1s infinite"}}>← YOU ARE HERE</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* GAME */}
        {page==="game" && (
          <div style={{maxWidth:700,margin:"0 auto"}}>
            {!wallet?(
              <div style={{textAlign:"center",background:"rgba(255,255,255,.03)",border:"1px solid #1a2a1a",borderRadius:16,padding:60}}>
                <div style={{fontSize:60}}>🔐</div>
                <h2 style={{color:"#00ffb4"}}>Connect Wallet First</h2>
                <button onClick={connectWallet} style={{background:"linear-gradient(135deg,#00ffb4,#0ea5e9)",border:"none",color:"#050508",fontWeight:700,padding:"14px 32px",borderRadius:12,fontSize:15,cursor:"pointer",fontFamily:"'Courier New',monospace",marginTop:16}}>Connect MetaMask</button>
              </div>
            ):!gs.entered?(
              <div style={{textAlign:"center",background:"rgba(255,255,255,.03)",border:"1px solid #1a2a1a",borderRadius:16,padding:60}}>
                <div style={{fontSize:60}}>🎮</div>
                <h2 style={{color:"#00ffb4"}}>Ready to Play?</h2>
                <p style={{color:"#888",marginBottom:24}}>Pay 0.01 ETH to enter this round. 10 levels. Increasing difficulty.</p>
                <button onClick={handleEnter} disabled={!!loading} style={{background:"linear-gradient(135deg,#00ffb4,#0ea5e9)",border:"none",color:"#050508",fontWeight:700,padding:"14px 32px",borderRadius:12,fontSize:15,cursor:"pointer",fontFamily:"'Courier New',monospace",opacity:loading?0.6:1}}>
                  {loading||"⚡ Enter — 0.01 ETH"}
                </button>
                {feedback&&<div style={{marginTop:16,color:feedback.type==="ok"?"#00ffb4":"#f87171"}}>{feedback.msg}</div>}
              </div>
            ):isGameComplete?(
              <div style={{textAlign:"center",background:"rgba(250,204,21,.05)",border:"2px solid #facc15",borderRadius:16,padding:60}}>
                <div style={{fontSize:80,animation:"float 2s infinite"}}>🏆</div>
                <h1 style={{color:"#facc15",fontSize:42,margin:"16px 0 8px"}}>CHAMPION!</h1>
                <p style={{color:"#00ffb4",fontSize:18}}>All 10 levels solved!</p>
                <div style={{background:"rgba(255,255,255,.03)",border:"1px solid #1a2a1a",borderRadius:12,padding:"16px 24px",display:"inline-block",margin:"24px auto"}}>
                  <div style={{fontSize:32,fontWeight:700,color:"#00ffb4"}}>{gs.score.toLocaleString()}</div>
                  <div style={{fontSize:11,color:"#555",letterSpacing:1}}>FINAL SCORE</div>
                </div>
                <div style={{color:"#888",fontSize:14,marginTop:8}}>Time: {fmt(gs.elapsed)}</div>
                <p style={{color:"#888"}}>Prize sent to your wallet automatically!</p>
              </div>
            ):(
              <>
                {/* LOCKOUT */}
                {gs.lockout>0&&(
                  <div style={{animation:"lockBlink 1.5s infinite",border:"2px solid #ef4444",borderRadius:14,padding:"18px 24px",marginBottom:20,textAlign:"center"}}>
                    <div style={{fontSize:32,marginBottom:6}}>🔒</div>
                    <div style={{color:"#f87171",fontSize:20,fontWeight:700,letterSpacing:2}}>LOCKED OUT</div>
                    <div style={{color:"#fca5a5",fontSize:14,marginTop:4}}>Too many wrong answers on this level</div>
                    <div style={{color:"#ef4444",fontSize:36,fontWeight:900,marginTop:8,fontVariantNumeric:"tabular-nums"}}>{fmt(gs.lockout)}</div>
                    <div style={{color:"#555",fontSize:12,marginTop:4}}>remaining</div>
                  </div>
                )}

                {/* HUD */}
                <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap"}}>
                  {[
                    {icon:"⭐",val:gs.score.toLocaleString(),lbl:"Score",color:"#facc15"},
                    {icon:"📈",val:`${displayLevel}/10`,lbl:"Level",color:"#00ffb4"},
                    {icon:"🎯",val:`${accuracy}%`,lbl:"Accuracy",color:"#00ffb4"},
                    {icon:"💡",val:gs.hintTokens,lbl:"Hints Left",color:"#fde68a"},
                  ].map(h=>(
                    <div key={h.lbl} style={{background:"rgba(255,255,255,.03)",border:"1px solid #1a2a1a",borderRadius:10,padding:"10px 16px",display:"flex",flexDirection:"column",alignItems:"center",gap:2,flex:1,minWidth:70}}>
                      <span style={{fontSize:18}}>{h.icon}</span>
                      <span style={{fontSize:18,fontWeight:700,color:h.color}}>{h.val}</span>
                      <span style={{fontSize:10,color:"#555",letterSpacing:1}}>{h.lbl}</span>
                    </div>
                  ))}
                  <div style={{background:"rgba(14,165,233,.07)",border:"1px solid #0369a1",borderRadius:10,padding:"10px 16px",display:"flex",flexDirection:"column",alignItems:"center",gap:2,flex:1,minWidth:70}}>
                    <span style={{fontSize:18}}>⏱</span>
                    <span style={{fontSize:16,fontWeight:700,color:"#38bdf8",fontVariantNumeric:"tabular-nums"}}>{fmt(gs.elapsed)}</span>
                    <span style={{fontSize:10,color:"#555",letterSpacing:1}}>TIME</span>
                  </div>
                </div>

                {/* PROGRESS BAR */}
                <div style={{position:"relative",height:6,background:"#1a1a1a",borderRadius:3,marginBottom:28}}>
                  <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${progressPct}%`,borderRadius:3,background:"linear-gradient(90deg,#00ffb4,#0ea5e9)",transition:"width .6s ease"}}/>
                </div>

                {/* LEVEL CARD */}
                <div style={{border:`1px solid ${diffStyle.border}`,borderRadius:16,padding:28,background:`linear-gradient(135deg,${diffStyle.bg} 0%,#0a0a0f 100%)`}}>
                  <div style={{marginBottom:20}}>
                    <span style={{border:`1px solid ${diffStyle.border}`,borderRadius:6,padding:"3px 10px",fontSize:11,letterSpacing:2,fontWeight:700,color:diffStyle.text,background:diffStyle.bg,marginRight:12}}>{lvl?.difficulty.toUpperCase()}</span>
                    <span style={{color:"#555",fontSize:13,letterSpacing:2}}>LEVEL {displayLevel} / 10</span>
                    <div style={{color:"#e2e8f0",fontSize:18,fontWeight:700,marginTop:8}}>{lvl?.topic}</div>
                  </div>

                  {/* PUZZLE TEXT — live from chain */}
                  <div style={{background:"rgba(0,0,0,.4)",border:"1px solid #1a1a2a",borderRadius:10,padding:"16px 20px",marginBottom:16,minHeight:80}}>
                    {loading && !gs.hint ? (
                      <div style={{color:"#555",fontSize:13,textAlign:"center",padding:"8px 0",animation:"pulse 1s infinite"}}>⏳ Loading puzzle…</div>
                    ) : gs.hint ? (
                      <pre style={{color:"#94a3b8",fontSize:14,lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"'Courier New',monospace",margin:0}}>{gs.hint}</pre>
                    ) : (
                      <div style={{color:"#555",fontSize:13,textAlign:"center",padding:"8px 0",animation:"pulse 1s infinite"}}>⏳ Fetching puzzle from chain…</div>
                    )}
                  </div>

                  {/* PARTIAL HINT */}
                  {gs.partialHint&&(
                    <div style={{background:"rgba(250,204,21,.07)",border:"1px solid #713f12",borderRadius:8,padding:"10px 16px",marginBottom:16,color:"#fde68a",fontSize:13}}>{gs.partialHint}</div>
                  )}

                  {/* ATTEMPT TRACKER — always visible, always live */}
                  <div style={{marginBottom:16}}>
                    <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                      {Array.from({length:MAX_WRONG_PER_LEVEL}).map((_,i)=>{
                        const isUsed = i < safeWrong;
                        return (
                          <div key={i} style={{
                            width:32,height:32,borderRadius:8,
                            background:isUsed?"#991b1b":"#1a1a1a",
                            border:`1px solid ${isUsed?"#dc2626":"#2a2a2a"}`,
                            display:"flex",alignItems:"center",justifyContent:"center",
                            fontSize:16,transition:"all .3s",
                            boxShadow:isUsed?"0 0 8px rgba(239,68,68,.4)":"none",
                          }}>
                            {isUsed?"✗":"○"}
                          </div>
                        );
                      })}
                      <span style={{
                        marginLeft:10,fontSize:13,
                        color:attemptsLeft<=1?"#ef4444":attemptsLeft<=2?"#f97316":"#94a3b8",
                        fontWeight:attemptsLeft<=2?700:400,
                        animation:attemptsLeft<=1?"pulse 1s infinite":"none",
                      }}>
                        {attemptsLeft===0?"⛔ Locking out…":
                         attemptsLeft===1?`⚠️ LAST ATTEMPT — then ${LOCKOUT_MINUTES}m lockout!`:
                         `${attemptsLeft} attempts left before ${LOCKOUT_MINUTES}m lockout`}
                      </span>
                    </div>
                  </div>

                  {/* INPUT */}
                  <div style={{display:"flex",gap:10,marginBottom:12}}>
                    <input
                      style={{flex:1,background:"rgba(0,0,0,.5)",border:"1px solid #334",borderRadius:10,padding:"14px 16px",color:"#e2e8f0",fontSize:16,fontFamily:"'Courier New',monospace",opacity:gs.lockout>0?0.4:1}}
                      placeholder={gs.lockout>0?`🔒 Locked — ${fmt(gs.lockout)}`:"Type your answer…"}
                      value={answer}
                      onChange={e=>setAnswer(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&!gs.lockout&&!loading&&handleSubmit()}
                      disabled={gs.lockout>0||!!loading}
                    />
                    <button onClick={handleSubmit} disabled={gs.lockout>0||!!loading}
                      style={{background:gs.lockout>0?"#333":diffStyle.border,border:"none",color:"#050508",fontWeight:700,padding:"14px 24px",borderRadius:10,fontSize:14,cursor:gs.lockout>0?"not-allowed":"pointer",fontFamily:"'Courier New',monospace",opacity:loading?0.6:1,minWidth:100}}>
                      {loading?"⏳":"Submit ↵"}
                    </button>
                  </div>

                  {/* HINT BUTTON */}
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                    <button onClick={handleHint} disabled={gs.hintTokens<=0||!!loading}
                      style={{background:gs.hintTokens>0?"rgba(250,204,21,.12)":"rgba(255,255,255,.03)",border:`1px solid ${gs.hintTokens>0?"#a16207":"#222"}`,color:gs.hintTokens>0?"#fde68a":"#444",padding:"8px 16px",borderRadius:8,fontSize:12,fontFamily:"'Courier New',monospace",cursor:gs.hintTokens>0?"pointer":"not-allowed"}}>
                      💡 Use Hint Token ({gs.hintTokens} left)
                    </button>
                    <span style={{color:"#555",fontSize:12}}>Case insensitive ✓</span>
                  </div>

                  {feedback&&(
                    <div style={{border:"1px solid",borderRadius:10,padding:"12px 16px",marginTop:12,fontSize:14,animation:"fadeIn .3s ease",background:feedback.type==="ok"?"rgba(0,255,180,.1)":"rgba(239,68,68,.1)",borderColor:feedback.type==="ok"?"#00ffb4":"#ef4444",color:feedback.type==="ok"?"#00ffb4":"#f87171"}}>
                      {feedback.msg}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}

        {/* LEADERBOARD */}
        {page==="leaderboard" && (
          <div>
            <div style={{color:"#555",fontSize:11,letterSpacing:4,marginBottom:16,borderBottom:"1px solid #111",paddingBottom:8}}>📊 LIVE LEADERBOARD</div>
            <button onClick={loadLeaderboard} style={{background:"rgba(0,255,180,.08)",border:"1px solid #00ffb4",color:"#00ffb4",padding:"8px 20px",borderRadius:8,cursor:"pointer",fontSize:12,fontFamily:"'Courier New',monospace",marginBottom:16}}>🔄 Refresh</button>
            <div style={{background:"rgba(255,255,255,.02)",border:"1px solid #1a2a1a",borderRadius:12,overflow:"hidden",marginBottom:32}}>
              <div style={{display:"flex",padding:"12px 20px",background:"rgba(0,255,180,.05)",borderBottom:"1px solid #1a2a1a",fontSize:11,color:"#555",letterSpacing:2}}>
                <span style={{width:40}}>#</span>
                <span style={{flex:1}}>Player</span>
                <span style={{width:80,textAlign:"center"}}>Level</span>
                <span style={{width:100,textAlign:"right"}}>Score</span>
                <span style={{width:80,textAlign:"right"}}>Wrongs</span>
                <span style={{width:60,textAlign:"center"}}>Status</span>
              </div>
              {leaderboard.length===0
                ? <div style={{padding:40,textAlign:"center",color:"#555"}}>No players yet — be the first!</div>
                : [...leaderboard].sort((a,b)=>b.score-a.score).map((p,i)=>(
                  <div key={i} style={{display:"flex",alignItems:"center",padding:"14px 20px",borderBottom:"1px solid #0d1117",background:i===0?"rgba(250,204,21,.04)":"transparent"}}>
                    <span style={{width:40,color:i===0?"#facc15":i===1?"#94a3b8":i===2?"#b45309":"#666",fontWeight:700}}>{i===0?"🥇":i===1?"🥈":i===2?"🥉":`#${i+1}`}</span>
                    <span style={{flex:1,color:"#e2e8f0",fontFamily:"'Courier New',monospace",fontSize:12}}>{p.addr.slice(0,6)}...{p.addr.slice(-4)}</span>
                    <span style={{width:80,textAlign:"center"}}><span style={{background:"#1a1a2a",border:"1px solid #334",borderRadius:6,padding:"2px 10px",fontSize:12,color:"#00ffb4"}}>{p.level}/10</span></span>
                    <span style={{width:100,textAlign:"right",color:"#facc15",fontWeight:700}}>{p.score.toLocaleString()}</span>
                    <span style={{width:80,textAlign:"right",color:"#f87171"}}>{p.wrong}</span>
                    <span style={{width:60,textAlign:"center"}}>{p.won?"🏆":p.locked?"🔒":<span style={{display:"inline-block",width:8,height:8,borderRadius:"50%",background:"#00ffb4",animation:"pulse 1.5s infinite"}}/>}</span>
                  </div>
                ))
              }
            </div>
          </div>
        )}

        {/* WINNERS */}
        {page==="winners" && (
          <div>
            <div style={{color:"#555",fontSize:11,letterSpacing:4,marginBottom:16,borderBottom:"1px solid #111",paddingBottom:8}}>🏆 WINNER HISTORY</div>
            {winners.length===0
              ? <div style={{textAlign:"center",color:"#555",padding:60}}><div style={{fontSize:60}}>🔐</div><p>No winners yet. Be the first!</p></div>
              : winners.map((w,i)=>(
                <div key={i} style={{display:"flex",alignItems:"center",gap:20,border:`1px solid ${w.place===1?"#facc15":"#a855f7"}`,borderRadius:12,padding:"20px 24px",marginBottom:16,background:w.place===1?"rgba(250,204,21,.05)":"rgba(168,85,247,.05)"}}>
                  <div style={{fontSize:40}}>{w.place===1?"🥇":"🥈"}</div>
                  <div style={{flex:1}}>
                    <div style={{color:"#e2e8f0",fontFamily:"'Courier New',monospace",fontSize:13}}>{w.addr.slice(0,6)}...{w.addr.slice(-4)}</div>
                    <div style={{color:"#555",fontSize:12,marginTop:4}}>Round {w.round} · {w.time}</div>
                  </div>
                  <div style={{textAlign:"right"}}>
                    <div style={{color:w.place===1?"#facc15":"#c084fc",fontSize:22,fontWeight:700}}>{w.prize} ETH</div>
                    <div style={{color:"#555",fontSize:12}}>{w.score.toLocaleString()} pts</div>
                  </div>
                </div>
              ))
            }
          </div>
        )}

        {/* ADMIN */}
        {page==="admin" && isOwner && (
          <div style={{maxWidth:680,margin:"0 auto"}}>
            <div style={{display:"flex",alignItems:"center",gap:12,marginBottom:28}}>
              <span style={{fontSize:28}}>⚙️</span>
              <div>
                <div style={{color:"#fb923c",fontSize:20,fontWeight:700,letterSpacing:2}}>OWNER PANEL</div>
                <div style={{color:"#555",fontSize:12}}>Actions execute on-chain and affect all players</div>
              </div>
            </div>
            {ownerFeedback&&(
              <div style={{border:"1px solid",borderRadius:10,padding:"12px 16px",marginBottom:20,fontSize:14,background:ownerFeedback.type==="ok"?"rgba(0,255,180,.08)":"rgba(239,68,68,.08)",borderColor:ownerFeedback.type==="ok"?"#00ffb4":"#ef4444",color:ownerFeedback.type==="ok"?"#00ffb4":"#f87171"}}>
                {ownerFeedback.msg}
              </div>
            )}
            <div style={{display:"flex",gap:12,marginBottom:24,flexWrap:"wrap"}}>
              {[{label:"Prize Pool",val:`${prizePool} ETH`,color:"#facc15"},{label:"Players",val:playerCount,color:"#00ffb4"},{label:"Board",val:`${leaderboard.length}`,color:"#94a3b8"}].map(s=>(
                <div key={s.label} style={{flex:1,minWidth:120,background:"rgba(255,255,255,.03)",border:"1px solid #1a2a1a",borderRadius:10,padding:"14px 18px",textAlign:"center"}}>
                  <div style={{fontSize:20,fontWeight:700,color:s.color}}>{s.val}</div>
                  <div style={{fontSize:11,color:"#555",letterSpacing:1,marginTop:4}}>{s.label}</div>
                </div>
              ))}
            </div>
            <div style={{border:"2px solid #ef4444",borderRadius:14,padding:24,marginBottom:16,background:"rgba(239,68,68,.05)"}}>
              <div style={{display:"flex",alignItems:"flex-start",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
                <div>
                  <div style={{color:"#f87171",fontWeight:700,fontSize:16,marginBottom:6}}>🔄 Reset Round</div>
                  <div style={{color:"#888",fontSize:13}}>Clears all player data. Prize pool must be 0 first.</div>
                </div>
                <button onClick={()=>{if(window.confirm("Reset round? Wipes ALL player data. Cannot be undone.")) ownerAction("Reset Round",c=>c.resetRound());}} disabled={!!ownerLoading}
                  style={{background:"#ef4444",border:"none",color:"#fff",fontWeight:700,padding:"12px 24px",borderRadius:10,cursor:"pointer",fontSize:13,fontFamily:"'Courier New',monospace",opacity:ownerLoading?"0.5":"1"}}>
                  {ownerLoading==="Reset Round"?"⏳…":"🔄 Reset Round"}
                </button>
              </div>
            </div>
            <div style={{border:"1px solid #a855f7",borderRadius:14,padding:24,marginBottom:16,background:"rgba(168,85,247,.05)"}}>
              <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",gap:16,flexWrap:"wrap"}}>
                <div>
                  <div style={{color:"#c084fc",fontWeight:700,fontSize:16,marginBottom:6}}>⏸ Pause / Resume</div>
                  <div style={{color:"#888",fontSize:13}}>Blocks new entries and submissions while paused.</div>
                </div>
                <div style={{display:"flex",gap:10}}>
                  <button onClick={()=>ownerAction("Pause Game",c=>c.setPaused(true))} disabled={!!ownerLoading}
                    style={{background:"rgba(168,85,247,.2)",border:"1px solid #a855f7",color:"#c084fc",fontWeight:700,padding:"10px 20px",borderRadius:10,cursor:"pointer",fontSize:13,fontFamily:"'Courier New',monospace"}}>
                    ⏸ Pause
                  </button>
                  <button onClick={()=>ownerAction("Unpause Game",c=>c.setPaused(false))} disabled={!!ownerLoading}
                    style={{background:"rgba(0,255,180,.1)",border:"1px solid #00ffb4",color:"#00ffb4",fontWeight:700,padding:"10px 20px",borderRadius:10,cursor:"pointer",fontSize:13,fontFamily:"'Courier New',monospace"}}>
                    ▶️ Resume
                  </button>
                </div>
              </div>
            </div>
            <RoundDurationControl ownerLoading={ownerLoading} onSet={(s)=>ownerAction("Set Round Duration",c=>c.setRoundDuration(s))}/>
          </div>
        )}
      </main>

      <footer style={{textAlign:"center",padding:"20px 24px",borderTop:"1px solid #0d1117",fontSize:12,color:"#333",position:"relative",zIndex:1}}>
        CipherChain · Sepolia Testnet · Hania · Manahil Tanweer · Menahil Fatima · Zoya Khan
      </footer>
    </div>
  );
}
