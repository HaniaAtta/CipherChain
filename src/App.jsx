import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESS, ABI } from "./contract";

// Hints are now fetched live from the contract via getHint() so the card
// always shows the puzzle that matches the player's on-chain currentLevel.
// This fallback array is only used if the RPC call fails.
const HINT_FALLBACK = [
  "I am a chain of blocks where each block holds transaction data. Tamper with one block and the entire chain breaks. What am I?",
  "I am a pseudonymous person or group who published the Bitcoin whitepaper in 2008 and vanished. Who am I?",
  "I am block number zero. Every blockchain begins with me. I have no parent. What am I called?",
  "I am the consensus mechanism where validators lock up ETH as collateral to earn the right to propose blocks. Slashing punishes dishonesty. What am I?",
  "Bitcoin uses me to secure its network. Miners compete to solve computationally expensive puzzles. The winner earns a block reward. What consensus mechanism am I?",
  "On Ethereum, every computation costs me. I am denominated in Gwei. I prevent infinite loops from halting the network. What am I called?",
  "mapping(address => uint256) public balances;\nfunction withdraw(uint256 amt) external {\n  balances[msg.sender] -= amt;\n  payable(msg.sender).call{value: amt}('');\n}\nThis code contains a critical vulnerability. What is it called?",
  "Two parties can transact without needing to trust each other or a third party. The smart contract enforces rules automatically. No bank, no escrow, no middleman. What single word describes this property?",
  "Decode this binary string to ASCII:\n01110111 01100001 01101100 01101100 01100101 01110100\nEach group of 8 bits is one character. What word does it spell?",
  "Bitcoin block reward started at 50 BTC. It halves every 210,000 blocks. At the FOURTH halving (block 840,000), what was the block reward? Write as a decimal.",
];

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
const LOCKOUT_MINUTES = 60; // match your contract

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

// ── Countdown display helper ──────────────────────────────────────────────────
function fmt(sec) {
  const h = Math.floor(sec/3600);
  const m = Math.floor((sec%3600)/60);
  const s = sec%60;
  if(h>0) return `${h}h ${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;
  return `${String(m).padStart(2,"0")}m ${String(s).padStart(2,"0")}s`;
}

export default function App() {
  const [page, setPage] = useState("home");
  const [wallet, setWallet] = useState("");
  const [entered, setEntered] = useState(false);

  // ── Game state (all sourced from chain) ──────────────────────────────────
  const [currentLevel, setCurrentLevel] = useState(0);  // 0-based index
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [score, setScore] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [wrongs, setWrongs] = useState(0);
  const [hintTokens, setHintTokens] = useState(2);
  const [partialHint, setPartialHint] = useState("");
  const [lockout, setLockout] = useState(0);        // seconds remaining
  const [won, setWon] = useState(false);
  const [wrongOnLevel, setWrongOnLevel] = useState(0);
  const [gameStartedAt, setGameStartedAt] = useState(null); // JS Date or null
  const [elapsed, setElapsed] = useState(0);               // seconds since entry
  // The puzzle text fetched live from the contract for the player's current level
  const [currentHint, setCurrentHint] = useState("");

  // ── Global stats ─────────────────────────────────────────────────────────
  const [prizePool, setPrizePool] = useState("0");
  const [playerCount, setPlayerCount] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [winners, setWinners] = useState([]);
  const [loading, setLoading] = useState("");

  // ── Lockout countdown ────────────────────────────────────────────────────
  useEffect(()=>{
    if(lockout<=0) return;
    const t=setInterval(()=>setLockout(l=>Math.max(0,l-1)),1000);
    return()=>clearInterval(t);
  },[lockout]);

  // ── Elapsed game timer ───────────────────────────────────────────────────
  useEffect(()=>{
    if(!gameStartedAt || won) return;
    const t=setInterval(()=>setElapsed(Math.floor((Date.now()-gameStartedAt)/1000)),1000);
    return()=>clearInterval(t);
  },[gameStartedAt, won]);

  // ── Auto-reload when wallet connects ─────────────────────────────────────
  useEffect(()=>{ if(wallet) loadMyStatsForAddress(wallet); },[wallet]);

  // ─────────────────────────────────────────────────────────────────────────
  const getContract = async (needSigner=false) => {
    if(!window.ethereum) throw new Error("MetaMask not found");
    const provider = new ethers.BrowserProvider(window.ethereum);
    if(needSigner){
      const signer = await provider.getSigner();
      return new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    }
    return new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
  };

  // Fetch the puzzle hint for the player's current level directly from chain.
  // getHint() returns the hint for msg.sender's currentLevel, so it's always
  // in sync with on-chain state — no index mismatch possible.
  const loadCurrentHint = async (levelIndex) => {
    // levelIndex is 0-based (same as contract's currentLevel)
    if(levelIndex >= LEVELS.length) return; // won — no more hints needed
    try {
      const c = await getContract();
      // Use getHintForLevel(levelNumber) which is public — levelNumber is 1-based
      const hint = await c.getHintForLevel(levelIndex + 1);
      setCurrentHint(hint);
    } catch(e) {
      console.error("loadCurrentHint failed, using fallback:", e);
      setCurrentHint(HINT_FALLBACK[levelIndex] || "");
    }
  };

  const connectWallet = async () => {
    if(!window.ethereum){ alert("Please install MetaMask!"); return; }
    const accounts = await window.ethereum.request({method:"eth_requestAccounts"});
    setWallet(accounts[0]);
    await loadGameStatus();
    await loadMyStatsForAddress(accounts[0]);
  };

  const loadGameStatus = async () => {
    try {
      const c = await getContract();
      const status = await c.getGameStatus();
      setPrizePool(ethers.formatEther(status.prizePool));
      setPlayerCount(Number(status.playerCount));
    } catch(e){ console.error("loadGameStatus:", e); }
  };

  // ── Central stats loader ──────────────────────────────────────────────────
  // currentLevel from chain is 0-based (level 0 = first puzzle, level 10 = done)
  const applyStats = async (stats, addr) => {
    const lvl = Number(stats.currentLevel);          // 0-9 active, 10 = won
    setCurrentLevel(lvl);
    setAttempts(Number(stats.totalAttempts));
    setWrongs(Number(stats.wrongAttempts));
    setScore(Number(stats.score));
    setHintTokens(Number(stats.hintTokensLeft));
    setWon(stats.hasWon || lvl >= LEVELS.length);

    if(stats.isLockedOut){
      setLockout(Number(stats.lockoutSecondsRemaining));
    } else {
      setLockout(0);
    }

    // Reconstruct approximate game start time from secondsInGame
    const secondsIn = Number(stats.secondsInGame || 0);
    if(secondsIn > 0){
      setGameStartedAt(Date.now() - secondsIn * 1000);
      setElapsed(secondsIn);
      setEntered(true);
    }

    if(Number(stats.totalAttempts) > 0 || lvl > 0 || Number(stats.score) > 0){
      setEntered(true);
    }

    // Get wrongOnCurrentLevel from players mapping
    if(addr){
      try {
        const c = await getContract();
        const raw = await c.players(addr);
        setWrongOnLevel(Number(raw.wrongOnCurrentLevel || 0));
      } catch(_){}
    }

    // KEY FIX: fetch the actual puzzle text for this level from the contract
    // so the question card always matches the player's real on-chain currentLevel
    await loadCurrentHint(lvl);
  };

  const loadMyStats = async () => {
    try {
      const c = await getContract();
      const stats = await c.getMyStats();
      const provider = new ethers.BrowserProvider(window.ethereum);
      const signer = await provider.getSigner();
      const addr = await signer.getAddress();
      await applyStats(stats, addr);
    } catch(e){ console.error("loadMyStats:", e); }
  };

  const loadMyStatsForAddress = async (addr) => {
    try {
      const c = await getContract();
      const stats = await c.getMyStats();
      await applyStats(stats, addr);
    } catch(e){ console.error("loadMyStatsForAddress:", e); }
  };

  const loadLeaderboard = async () => {
    try {
      const c = await getContract();
      const board = await c.getLeaderboard();
      setLeaderboard(board.map(e=>({
        addr: e.player,
        level: Number(e.currentLevel),
        score: Number(e.score),
        wrong: Number(e.wrongAttempts),
        won: e.hasWon,
        locked: e.isLockedOut,
      })));
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

  // ── Actions ───────────────────────────────────────────────────────────────
  const handleEnter = async () => {
    try {
      setLoading("Entering game...");
      const c = await getContract(true);
      const tx = await c.enterGame({value: ethers.parseEther("0.01")});
      setFeedback({type:"ok",msg:"⏳ Transaction sent, waiting..."});
      await tx.wait();
      setEntered(true);
      setGameStartedAt(Date.now());
      setElapsed(0);
      setFeedback({type:"ok",msg:"✅ Entered! 0.01 ETH paid. Good luck!"});
      setCurrentLevel(0);
      setScore(0);
      setAttempts(0);
      setWrongs(0);
      setHintTokens(2);
      setWrongOnLevel(0);
      setWon(false);
      setPartialHint("");
      setCurrentHint("");
      await loadMyStats();
      await loadGameStatus();
      setPage("game");
    } catch(e){
      const msg = e.reason || e.message || "";
      if(msg.includes("already entered")){
        setEntered(true);
        await loadMyStats();
        setPage("game");
        setFeedback(null);
      } else {
        setFeedback({type:"err",msg:`❌ ${msg}`});
      }
    } finally { setLoading(""); }
  };

  const handleSubmit = async () => {
    if(lockout>0 || !answer.trim()) return;
    try {
      setLoading("Submitting...");
      const c = await getContract(true);
      const tx = await c.submitAnswer(answer.trim());
      setFeedback({type:"ok",msg:"⏳ Checking answer on chain..."});
      await tx.wait();
      setAnswer("");
      setWrongOnLevel(0);
      setPartialHint("");
      setCurrentHint(""); // clear old puzzle while new one loads from chain
      setFeedback({type:"ok",msg:"✅ Correct! Moving to next level..."});
      await loadMyStats();
      await loadGameStatus();
    } catch(e){
      const msg = e.reason || e.message || "";
      if(msg.includes("wrong answer")){
        setFeedback({type:"err",msg:"❌ Wrong answer. Try again!"});
        await loadMyStats();
      } else if(msg.includes("locked out")){
        setFeedback({type:"err",msg:`🔒 Too many wrong answers! Locked out for ${LOCKOUT_MINUTES} minutes.`});
        await loadMyStats();
      } else if(msg.includes("enter the game")){
        setFeedback({type:"err",msg:"❌ Please enter the game first."});
      } else {
        setFeedback({type:"err",msg:`❌ ${msg}`});
      }
    } finally { setLoading(""); }
  };

  const handleHint = async () => {
    if(hintTokens<=0) return;
    try {
      setLoading("Getting hint...");
      const c = await getContract(true);
      const tx = await c.useHintToken();
      await tx.wait();
      await loadMyStats();
      const c2 = await getContract();
      const hint = await c2.getHint();
      setPartialHint("💡 " + hint);
      setFeedback(null);
    } catch(e){
      setFeedback({type:"err",msg:`❌ ${e.reason||e.message}`});
    } finally { setLoading(""); }
  };

  // ── Derived display values ────────────────────────────────────────────────
  // currentLevel is 0-based index into LEVELS[]. Level 10 means all done.
  const isGameComplete = won || currentLevel >= LEVELS.length;
  const safeLevel      = Math.min(currentLevel, LEVELS.length - 1);
  const lvl            = LEVELS[safeLevel];
  const diffStyle      = DIFF_COLOR[lvl.difficulty] || DIFF_COLOR.Easy;
  const progressPct    = (currentLevel / LEVELS.length) * 100;
  const safeWrong      = Math.max(0, Math.min(MAX_WRONG_PER_LEVEL, wrongOnLevel));
  const attemptsLeft   = MAX_WRONG_PER_LEVEL - safeWrong;
  const displayLevel   = currentLevel + 1;           // 1-based for humans

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{minHeight:"100vh",background:"#050508",fontFamily:"'Courier New',monospace",color:"#e2e8f0",position:"relative",overflowX:"hidden"}}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
        @keyframes shake{0%,100%{transform:translateX(0)}20%,60%{transform:translateX(-6px)}40%,80%{transform:translateX(6px)}}
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

      {/* ── NAV ─────────────────────────────────────────────────────────── */}
      <nav style={{position:"sticky",top:0,zIndex:100,background:"rgba(5,5,8,.9)",backdropFilter:"blur(12px)",borderBottom:"1px solid #0d2b1a",display:"flex",alignItems:"center",justifyContent:"space-between",padding:"0 32px",height:60}}>
        <div style={{display:"flex",alignItems:"center",gap:10,cursor:"pointer"}} onClick={()=>setPage("home")}>
          <span style={{fontSize:26,color:"#00ffb4"}}>⬡</span>
          <span style={{fontSize:20,fontWeight:700,letterSpacing:2,color:"#00ffb4"}}>CipherChain</span>
        </div>
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {["home","game","leaderboard","winners"].map(p=>(
            <button key={p} onClick={()=>{
              setPage(p);
              if(p==="leaderboard") loadLeaderboard();
              if(p==="winners")     loadWinners();
              if(p==="game"&&wallet) loadMyStats();
            }} style={{background:page===p?"rgba(0,255,180,.1)":"transparent",border:`1px solid ${page===p?"#00ffb4":"#1a2a1a"}`,color:page===p?"#00ffb4":"#666",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontSize:12,letterSpacing:.5,fontFamily:"'Courier New',monospace"}}>
              {p==="home"?"🏠 Home":p==="game"?"🎮 Play":p==="leaderboard"?"📊 Board":"🏆 Winners"}
            </button>
          ))}
          {wallet
            ? <span style={{color:"#00ffb4",fontSize:11,background:"rgba(0,255,180,.1)",border:"1px solid #00ffb4",padding:"4px 10px",borderRadius:6}}>{wallet.slice(0,6)}...{wallet.slice(-4)}</span>
            : <button onClick={connectWallet} style={{background:"linear-gradient(135deg,#00ffb4,#0ea5e9)",border:"none",color:"#050508",fontWeight:700,padding:"8px 16px",borderRadius:8,cursor:"pointer",fontSize:12,fontFamily:"'Courier New',monospace"}}>Connect Wallet</button>
          }
        </div>
      </nav>

      <main style={{position:"relative",zIndex:1,maxWidth:1000,margin:"0 auto",padding:"40px 24px 80px"}}>

        {/* ── HOME ──────────────────────────────────────────────────────── */}
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
              ? <button onClick={connectWallet} style={{background:"linear-gradient(135deg,#00ffb4,#0ea5e9)",border:"none",color:"#050508",fontWeight:700,padding:"16px 40px",borderRadius:12,fontSize:16,cursor:"pointer",letterSpacing:1,boxShadow:"0 0 40px rgba(0,255,180,.25)",fontFamily:"'Courier New',monospace",marginBottom:48}}>🔌 Connect Wallet First</button>
              : <button onClick={()=>{setPage("game");loadMyStats();}} style={{background:"linear-gradient(135deg,#00ffb4,#0ea5e9)",border:"none",color:"#050508",fontWeight:700,padding:"16px 40px",borderRadius:12,fontSize:16,cursor:"pointer",letterSpacing:1,boxShadow:"0 0 40px rgba(0,255,180,.25)",fontFamily:"'Courier New',monospace",marginBottom:48}}>
                  {entered ? "🎮 Continue Playing" : "⚡ Enter Game — 0.01 ETH"}
                </button>
            }
            <div style={{color:"#555",fontSize:11,letterSpacing:4,marginBottom:16,borderBottom:"1px solid #111",paddingBottom:8}}>PUZZLE LEVELS</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12}}>
              {LEVELS.map((l,i)=>{
                const ds=DIFF_COLOR[l.difficulty];
                return(
                  <div key={l.id} style={{border:`1px solid ${ds.border}`,borderRadius:10,padding:"14px 16px",background:ds.bg,opacity:entered&&i<currentLevel?0.5:1}}>
                    <div style={{fontSize:11,color:"#666",marginBottom:4}}>#{l.id}</div>
                    <div style={{color:ds.text,fontSize:11,fontWeight:700,letterSpacing:1}}>{l.difficulty.toUpperCase()}</div>
                    <div style={{color:"#ccc",fontSize:12,marginTop:4,lineHeight:1.4}}>{l.topic}</div>
                    {entered&&i<currentLevel&&<div style={{color:ds.text,marginTop:6,fontSize:18}}>✓</div>}
                    {entered&&i===currentLevel&&<div style={{color:"#00ffb4",marginTop:6,fontSize:12,animation:"pulse 1s infinite"}}>← YOU ARE HERE</div>}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── GAME ──────────────────────────────────────────────────────── */}
        {page==="game" && (
          <div style={{maxWidth:700,margin:"0 auto"}}>
            {!wallet?(
              <div style={{textAlign:"center",background:"rgba(255,255,255,.03)",border:"1px solid #1a2a1a",borderRadius:16,padding:60}}>
                <div style={{fontSize:60}}>🔐</div>
                <h2 style={{color:"#00ffb4"}}>Connect Wallet First</h2>
                <button onClick={connectWallet} style={{background:"linear-gradient(135deg,#00ffb4,#0ea5e9)",border:"none",color:"#050508",fontWeight:700,padding:"14px 32px",borderRadius:12,fontSize:15,cursor:"pointer",fontFamily:"'Courier New',monospace",marginTop:16}}>Connect MetaMask</button>
              </div>
            ):!entered?(
              <div style={{textAlign:"center",background:"rgba(255,255,255,.03)",border:"1px solid #1a2a1a",borderRadius:16,padding:60}}>
                <div style={{fontSize:60}}>🎮</div>
                <h2 style={{color:"#00ffb4"}}>Ready to Play?</h2>
                <p style={{color:"#888",marginBottom:24}}>Pay 0.01 ETH to enter this round.</p>
                <button onClick={handleEnter} style={{background:"linear-gradient(135deg,#00ffb4,#0ea5e9)",border:"none",color:"#050508",fontWeight:700,padding:"14px 32px",borderRadius:12,fontSize:15,cursor:"pointer",fontFamily:"'Courier New',monospace"}}>{loading||"⚡ Enter — 0.01 ETH"}</button>
                {feedback&&<div style={{marginTop:16,color:feedback.type==="ok"?"#00ffb4":"#f87171"}}>{feedback.msg}</div>}
              </div>
            ):isGameComplete?(
              <div style={{textAlign:"center",background:"rgba(250,204,21,.05)",border:"2px solid #facc15",borderRadius:16,padding:60}}>
                <div style={{fontSize:80,animation:"float 2s infinite"}}>🏆</div>
                <h1 style={{color:"#facc15",fontSize:42,margin:"16px 0 8px"}}>CHAMPION!</h1>
                <p style={{color:"#00ffb4",fontSize:18}}>All 10 levels solved!</p>
                <div style={{background:"rgba(255,255,255,.03)",border:"1px solid #1a2a1a",borderRadius:12,padding:"16px 24px",display:"inline-block",margin:"24px auto"}}>
                  <div style={{fontSize:32,fontWeight:700,color:"#00ffb4"}}>{score.toLocaleString()}</div>
                  <div style={{fontSize:11,color:"#555",letterSpacing:1}}>FINAL SCORE</div>
                </div>
                <div style={{color:"#888",fontSize:14,marginTop:8}}>Time: {fmt(elapsed)}</div>
                <p style={{color:"#888"}}>Prize sent to your wallet automatically!</p>
              </div>
            ):(
              <>
                {/* ── LOCKOUT BANNER ────────────────────────────────────── */}
                {lockout>0&&(
                  <div style={{animation:"lockBlink 1.5s infinite",border:"2px solid #ef4444",borderRadius:14,padding:"18px 24px",marginBottom:20,textAlign:"center"}}>
                    <div style={{fontSize:32,marginBottom:6}}>🔒</div>
                    <div style={{color:"#f87171",fontSize:20,fontWeight:700,letterSpacing:2}}>LOCKED OUT</div>
                    <div style={{color:"#fca5a5",fontSize:14,marginTop:4}}>Too many wrong answers on this level</div>
                    <div style={{color:"#ef4444",fontSize:36,fontWeight:900,marginTop:8,letterSpacing:4,fontVariantNumeric:"tabular-nums"}}>
                      {fmt(lockout)}
                    </div>
                    <div style={{color:"#555",fontSize:12,marginTop:4}}>remaining before you can try again</div>
                  </div>
                )}

                {/* ── HUD ───────────────────────────────────────────────── */}
                <div style={{display:"flex",gap:12,marginBottom:16,flexWrap:"wrap"}}>
                  {[
                    {icon:"⭐",val:score.toLocaleString(),lbl:"Score"},
                    // FIX: show displayLevel (1-based) correctly
                    {icon:"📈",val:`${displayLevel}/10`,lbl:"Level"},
                    {icon:"🎯",val:`${attempts>0?Math.round(((attempts-wrongs)/attempts)*100):100}%`,lbl:"Accuracy"},
                    {icon:"💡",val:hintTokens,lbl:"Hints Left"},
                  ].map(h=>(
                    <div key={h.lbl} style={{background:"rgba(255,255,255,.03)",border:"1px solid #1a2a1a",borderRadius:10,padding:"10px 16px",display:"flex",flexDirection:"column",alignItems:"center",gap:2,flex:1,minWidth:70}}>
                      <span style={{fontSize:18}}>{h.icon}</span>
                      <span style={{fontSize:18,fontWeight:700,color:"#00ffb4"}}>{h.val}</span>
                      <span style={{fontSize:10,color:"#555",letterSpacing:1}}>{h.lbl}</span>
                    </div>
                  ))}
                  {/* ── GAME TIMER ────── */}
                  <div style={{background:"rgba(14,165,233,.07)",border:"1px solid #0369a1",borderRadius:10,padding:"10px 16px",display:"flex",flexDirection:"column",alignItems:"center",gap:2,flex:1,minWidth:70}}>
                    <span style={{fontSize:18}}>⏱</span>
                    <span style={{fontSize:16,fontWeight:700,color:"#38bdf8",fontVariantNumeric:"tabular-nums"}}>{fmt(elapsed)}</span>
                    <span style={{fontSize:10,color:"#555",letterSpacing:1}}>TIME</span>
                  </div>
                </div>

                {/* ── PROGRESS BAR ──────────────────────────────────────── */}
                <div style={{position:"relative",height:6,background:"#1a1a1a",borderRadius:3,marginBottom:28}}>
                  <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${progressPct}%`,borderRadius:3,background:"linear-gradient(90deg,#00ffb4,#0ea5e9)",transition:"width .4s ease"}}/>
                </div>

                {/* ── LEVEL CARD ────────────────────────────────────────── */}
                <div style={{border:`1px solid ${diffStyle.border}`,borderRadius:16,padding:28,background:`linear-gradient(135deg,${diffStyle.bg} 0%,#0a0a0f 100%)`}}>
                  <div style={{marginBottom:20}}>
                    <span style={{border:`1px solid ${diffStyle.border}`,borderRadius:6,padding:"3px 10px",fontSize:11,letterSpacing:2,fontWeight:700,color:diffStyle.text,background:diffStyle.bg,marginRight:12}}>{lvl.difficulty.toUpperCase()}</span>
                    {/* FIX: correct level display — displayLevel is 1-based */}
                    <span style={{color:"#555",fontSize:13,letterSpacing:2}}>LEVEL {displayLevel} / 10</span>
                    <div style={{color:"#e2e8f0",fontSize:18,fontWeight:700,marginTop:8}}>{lvl.topic}</div>
                  </div>

                  <div style={{background:"rgba(0,0,0,.4)",border:"1px solid #1a1a2a",borderRadius:10,padding:"16px 20px",marginBottom:16}}>
                    {currentHint
                      ? <pre style={{color:"#94a3b8",fontSize:14,lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"'Courier New',monospace",margin:0}}>{currentHint}</pre>
                      : <div style={{color:"#555",fontSize:13,textAlign:"center",padding:"8px 0",animation:"pulse 1s infinite"}}>⏳ Loading puzzle…</div>
                    }
                  </div>

                  {partialHint&&(
                    <div style={{background:"rgba(250,204,21,.07)",border:"1px solid #713f12",borderRadius:8,padding:"10px 16px",marginBottom:16,color:"#fde68a",fontSize:13}}>{partialHint}</div>
                  )}

                  {/* ── ATTEMPT TRACKER ───────────────────────────────────
                      Always show so players know how many chances they have */}
                  <div style={{marginBottom:16}}>
                    <div style={{display:"flex",gap:6,alignItems:"center",flexWrap:"wrap"}}>
                      {Array.from({length:MAX_WRONG_PER_LEVEL}).map((_,i)=>{
                        const isUsed = i < safeWrong;
                        const isLast = i === MAX_WRONG_PER_LEVEL - 1;
                        return (
                          <div key={i} style={{
                            width:32, height:32, borderRadius:8,
                            background: isUsed ? (isLast ? "#7f1d1d" : "#991b1b") : "#1a1a1a",
                            border:`1px solid ${isUsed ? (isLast?"#ef4444":"#dc2626") : "#2a2a2a"}`,
                            display:"flex",alignItems:"center",justifyContent:"center",
                            fontSize:16, transition:"all .2s",
                            boxShadow: isUsed ? "0 0 8px rgba(239,68,68,.3)" : "none",
                          }}>
                            {isUsed ? "✗" : "○"}
                          </div>
                        );
                      })}
                      <span style={{
                        marginLeft:10, fontSize:13,
                        color: attemptsLeft<=1 ? "#ef4444" : attemptsLeft<=2 ? "#f97316" : "#94a3b8",
                        fontWeight: attemptsLeft<=2 ? 700 : 400,
                        animation: attemptsLeft<=1 ? "pulse 1s infinite" : "none",
                      }}>
                        {attemptsLeft === 0
                          ? "⛔ Locking out now…"
                          : attemptsLeft === 1
                          ? `⚠️ LAST ATTEMPT — then locked ${LOCKOUT_MINUTES}m!`
                          : `${attemptsLeft} attempt${attemptsLeft!==1?"s":""} left before ${LOCKOUT_MINUTES}m lockout`
                        }
                      </span>
                    </div>
                  </div>

                  {/* ── INPUT ROW ─────────────────────────────────────────── */}
                  <div style={{display:"flex",gap:10,marginBottom:12}}>
                    <input
                      style={{flex:1,background:"rgba(0,0,0,.5)",border:"1px solid #334",borderRadius:10,padding:"14px 16px",color:"#e2e8f0",fontSize:16,fontFamily:"'Courier New',monospace",opacity:lockout>0?0.4:1}}
                      placeholder={lockout>0?`🔒 Locked — ${fmt(lockout)}`:"Type your answer…"}
                      value={answer}
                      onChange={e=>setAnswer(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&!lockout&&!loading&&handleSubmit()}
                      disabled={lockout>0}
                    />
                    <button
                      onClick={handleSubmit}
                      disabled={lockout>0||!!loading}
                      style={{background:lockout>0?"#333":diffStyle.border,border:"none",color:"#050508",fontWeight:700,padding:"14px 24px",borderRadius:10,fontSize:14,cursor:lockout>0?"not-allowed":"pointer",fontFamily:"'Courier New',monospace",opacity:loading?0.6:1,minWidth:100}}
                    >
                      {loading?"⏳":"Submit ↵"}
                    </button>
                  </div>

                  {/* ── HINT BUTTON ───────────────────────────────────────── */}
                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                    <div style={{display:"flex",flexDirection:"column",gap:4}}>
                      <button
                        onClick={handleHint}
                        disabled={hintTokens<=0||!!loading}
                        style={{
                          background: hintTokens>0 ? "rgba(250,204,21,.12)" : "rgba(255,255,255,.03)",
                          border:`1px solid ${hintTokens>0?"#a16207":"#222"}`,
                          color: hintTokens>0 ? "#fde68a" : "#444",
                          padding:"8px 16px",borderRadius:8,fontSize:12,
                          fontFamily:"'Courier New',monospace",
                          cursor:hintTokens>0?"pointer":"not-allowed",
                          transition:"all .2s",
                        }}
                      >
                        💡 Use Hint Token ({hintTokens} left)
                      </button>
                      {hintTokens===0&&(
                        <span style={{color:"#555",fontSize:11}}>No hint tokens remaining</span>
                      )}
                    </div>
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

        {/* ── LEADERBOARD ───────────────────────────────────────────────── */}
        {page==="leaderboard" && (
          <div>
            <div style={{color:"#555",fontSize:11,letterSpacing:4,marginBottom:16,borderBottom:"1px solid #111",paddingBottom:8}}>📊 LIVE LEADERBOARD</div>
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

        {/* ── WINNERS ─────────────────────────────────────────────── */}
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
      </main>

      <footer style={{textAlign:"center",padding:"20px 24px",borderTop:"1px solid #0d1117",fontSize:12,color:"#333",position:"relative",zIndex:1}}>
        CipherChain · Sepolia Testnet · Hania · Manahil Tanweer · Menahil Fatima · Zoya Khan
      </footer>
    </div>
  );
}
