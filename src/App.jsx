import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";
import { CONTRACT_ADDRESS, ABI } from "./contract";


const HINTS = [
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
  { id:1, difficulty:"Easy",      topic:"What is a blockchain?"         },
  { id:2, difficulty:"Easy",      topic:"Who created Bitcoin?"           },
  { id:3, difficulty:"Easy",      topic:"What is block zero?"            },
  { id:4, difficulty:"Medium",    topic:"ETH consensus mechanism"        },
  { id:5, difficulty:"Medium",    topic:"Bitcoin consensus mechanism"    },
  { id:6, difficulty:"Medium",    topic:"Ethereum execution cost unit"   },
  { id:7, difficulty:"Hard",      topic:"Read Solidity — find the bug"   },
  { id:8, difficulty:"Hard",      topic:"Trustless property"             },
  { id:9, difficulty:"Very Hard", topic:"Decode binary to ASCII"         },
  { id:10,difficulty:"Extreme",   topic:"4th Bitcoin halving reward"     },
];

const DIFF_COLOR = {
  Easy:       { bg:"#0d2b1a", border:"#22c55e", text:"#4ade80" },
  Medium:     { bg:"#1a1a0a", border:"#eab308", text:"#facc15" },
  Hard:       { bg:"#2a0d0d", border:"#ef4444", text:"#f87171" },
  "Very Hard":{ bg:"#1a0d2a", border:"#a855f7", text:"#c084fc" },
  Extreme:    { bg:"#2a1500", border:"#f97316", text:"#fb923c" },
};

function ParticleBg() {
  const canvasRef = useRef(null);
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas.getContext("2d");
    let w = canvas.width = window.innerWidth;
    let h = canvas.height = window.innerHeight;
    const pts = Array.from({length:60},()=>({
      x:Math.random()*w,y:Math.random()*h,
      vx:(Math.random()-.5)*.3,vy:(Math.random()-.5)*.3,
      r:Math.random()*1.5+.5
    }));
    const resize=()=>{w=canvas.width=window.innerWidth;h=canvas.height=window.innerHeight};
    window.addEventListener("resize",resize);
    let raf;
    const draw=()=>{
      ctx.clearRect(0,0,w,h);
      pts.forEach(p=>{
        p.x+=p.vx;p.y+=p.vy;
        if(p.x<0)p.x=w;if(p.x>w)p.x=0;
        if(p.y<0)p.y=h;if(p.y>h)p.y=0;
        ctx.beginPath();ctx.arc(p.x,p.y,p.r,0,Math.PI*2);
        ctx.fillStyle="rgba(0,255,180,0.25)";ctx.fill();
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

export default function App() {
  const [page, setPage] = useState("home");
  const [wallet, setWallet] = useState("");
  const [entered, setEntered] = useState(false);
  const [currentLevel, setCurrentLevel] = useState(0);
  const [answer, setAnswer] = useState("");
  const [feedback, setFeedback] = useState(null);
  const [score, setScore] = useState(0);
  const [attempts, setAttempts] = useState(0);
  const [wrongs, setWrongs] = useState(0);
  const [hintTokens, setHintTokens] = useState(2);
  const [partialHint, setPartialHint] = useState("");
  const [lockout, setLockout] = useState(0);
  const [won, setWon] = useState(false);
  const [prizePool, setPrizePool] = useState("0");
  const [playerCount, setPlayerCount] = useState(0);
  const [leaderboard, setLeaderboard] = useState([]);
  const [winners, setWinners] = useState([]);
  const [loading, setLoading] = useState("");
  const [wrongOnLevel, setWrongOnLevel] = useState(0);

  useEffect(()=>{
    if(lockout<=0)return;
    const t=setInterval(()=>setLockout(l=>Math.max(0,l-1)),1000);
    return()=>clearInterval(t);
  },[lockout]);

  const getContract = async (needSigner=false) => {
    if(!window.ethereum) throw new Error("MetaMask not found");
    const provider = new ethers.BrowserProvider(window.ethereum);
    if(needSigner){
      const signer = await provider.getSigner();
      return new ethers.Contract(CONTRACT_ADDRESS, ABI, signer);
    }
    return new ethers.Contract(CONTRACT_ADDRESS, ABI, provider);
  };

  const connectWallet = async () => {
    if(!window.ethereum){ alert("Please install MetaMask!"); return; }
    const accounts = await window.ethereum.request({method:"eth_requestAccounts"});
    setWallet(accounts[0]);
    await loadGameStatus();
  };

  const loadGameStatus = async () => {
    try {
      const c = await getContract();
      const status = await c.getGameStatus();
      setPrizePool(ethers.formatEther(status.prizePool));
      setPlayerCount(Number(status.playerCount));
    } catch(e){ console.error(e); }
  };

  const loadMyStats = async () => {
    try {
      const c = await getContract();
      const stats = await c.getMyStats();
      setCurrentLevel(Number(stats.currentLevel));
      setAttempts(Number(stats.totalAttempts));
      setWrongs(Number(stats.wrongAttempts));
      setScore(Number(stats.score));
      setHintTokens(Number(stats.hintTokensLeft));
      setWon(stats.hasWon);
      if(stats.isLockedOut) setLockout(Number(stats.lockoutSecondsRemaining));
    } catch(e){ console.error(e); }
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

  const handleEnter = async () => {
    try {
      setLoading("Entering game...");
      const c = await getContract(true);
      const tx = await c.enterGame({value: ethers.parseEther("0.01")});
      setFeedback({type:"ok",msg:"⏳ Transaction sent, waiting..."});
      await tx.wait();
      setEntered(true);
      setFeedback({type:"ok",msg:"✅ Entered! 0.01 ETH paid. Good luck!"});
      await loadMyStats();
      await loadGameStatus();
      setPage("game");
    } catch(e){
      setFeedback({type:"err",msg:`❌ ${e.reason||e.message}`});
    } finally { setLoading(""); }
  };

  const handleSubmit = async () => {
    if(lockout>0||!answer.trim()) return;
    try {
      setLoading("Submitting...");
      const c = await getContract(true);
      const tx = await c.submitAnswer(answer.trim());
      setFeedback({type:"ok",msg:"⏳ Checking answer..."});
      await tx.wait();
      setAnswer("");
      setWrongOnLevel(0);
      await loadMyStats();
      setFeedback({type:"ok",msg:"✅ Correct! Moving to next level..."});
    } catch(e){
      const msg = e.reason||e.message||"";
      if(msg.includes("wrong answer")){
        const nw = wrongOnLevel+1;
        setWrongOnLevel(nw);
        setWrongs(w=>w+1);
        setFeedback({type:"err",msg:`❌ Wrong answer. ${5-nw} attempts left before lockout.`});
      } else if(msg.includes("locked out")){
        setFeedback({type:"err",msg:"🔒 You are locked out for 1 hour."});
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
      const receipt = await tx.wait();
      await loadMyStats();
      const hint = await (await getContract()).getHint();
      setPartialHint("💡 " + hint);
    } catch(e){
      setFeedback({type:"err",msg:`❌ ${e.reason||e.message}`});
    } finally { setLoading(""); }
  };

  const lvl = LEVELS[currentLevel] || LEVELS[0];
  const diffStyle = DIFF_COLOR[lvl.difficulty] || DIFF_COLOR.Easy;
  const progressPct = (currentLevel/LEVELS.length)*100;

  return (
    <div style={{minHeight:"100vh",background:"#050508",fontFamily:"'Courier New',monospace",color:"#e2e8f0",position:"relative",overflowX:"hidden"}}>
      <style>{`
        @keyframes pulse{0%,100%{opacity:1}50%{opacity:.5}}
        @keyframes float{0%,100%{transform:translateY(0)}50%{transform:translateY(-12px)}}
        @keyframes fadeIn{from{opacity:0;transform:translateY(4px)}to{opacity:1;transform:translateY(0)}}
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
        <div style={{display:"flex",gap:8,alignItems:"center"}}>
          {["home","game","leaderboard","winners"].map(p=>(
            <button key={p} onClick={()=>{setPage(p);if(p==="leaderboard")loadLeaderboard();if(p==="winners")loadWinners();}} style={{background:page===p?"rgba(0,255,180,.1)":"transparent",border:`1px solid ${page===p?"#00ffb4":"#1a2a1a"}`,color:page===p?"#00ffb4":"#666",padding:"6px 14px",borderRadius:8,cursor:"pointer",fontSize:12,letterSpacing:.5,fontFamily:"'Courier New',monospace"}}>
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
              ? <button onClick={connectWallet} style={{background:"linear-gradient(135deg,#00ffb4,#0ea5e9)",border:"none",color:"#050508",fontWeight:700,padding:"16px 40px",borderRadius:12,fontSize:16,cursor:"pointer",letterSpacing:1,boxShadow:"0 0 40px rgba(0,255,180,.25)",fontFamily:"'Courier New',monospace",marginBottom:48}}>🔌 Connect Wallet First</button>
              : <button onClick={handleEnter} style={{background:"linear-gradient(135deg,#00ffb4,#0ea5e9)",border:"none",color:"#050508",fontWeight:700,padding:"16px 40px",borderRadius:12,fontSize:16,cursor:"pointer",letterSpacing:1,boxShadow:"0 0 40px rgba(0,255,180,.25)",fontFamily:"'Courier New',monospace",marginBottom:48}}>
                  {loading||"⚡ Enter Game — 0.01 ETH"}
                </button>
            }

            <div style={{color:"#555",fontSize:11,letterSpacing:4,marginBottom:16,borderBottom:"1px solid #111",paddingBottom:8}}>PUZZLE LEVELS</div>
            <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fill,minmax(160px,1fr))",gap:12}}>
              {LEVELS.map((l,i)=>{
                const ds=DIFF_COLOR[l.difficulty];
                return(
                  <div key={l.id} style={{border:`1px solid ${ds.border}`,borderRadius:10,padding:"14px 16px",background:ds.bg,opacity:entered&&i<currentLevel?.5:1}}>
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

        {/* GAME */}
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
              </div>
            ):won?(
              <div style={{textAlign:"center",background:"rgba(250,204,21,.05)",border:"2px solid #facc15",borderRadius:16,padding:60}}>
                <div style={{fontSize:80,animation:"float 2s infinite"}}>🏆</div>
                <h1 style={{color:"#facc15",fontSize:42,margin:"16px 0 8px"}}>CHAMPION!</h1>
                <p style={{color:"#00ffb4",fontSize:18}}>All 10 levels solved!</p>
                <div style={{background:"rgba(255,255,255,.03)",border:"1px solid #1a2a1a",borderRadius:12,padding:"16px 24px",display:"inline-block",margin:"24px auto"}}>
                  <div style={{fontSize:32,fontWeight:700,color:"#00ffb4"}}>{score.toLocaleString()}</div>
                  <div style={{fontSize:11,color:"#555",letterSpacing:1}}>FINAL SCORE</div>
                </div>
                <p style={{color:"#888"}}>Prize sent to your wallet automatically!</p>
              </div>
            ):(
              <>
                {/* HUD */}
                <div style={{display:"flex",gap:12,marginBottom:20,flexWrap:"wrap"}}>
                  {[{icon:"⭐",val:score.toLocaleString(),lbl:"Score"},{icon:"📈",val:`${currentLevel}/10`,lbl:"Level"},{icon:"🎯",val:`${attempts>0?Math.round(((attempts-wrongs)/attempts)*100):100}%`,lbl:"Accuracy"},{icon:"💡",val:hintTokens,lbl:"Hints"}].map(h=>(
                    <div key={h.lbl} style={{background:"rgba(255,255,255,.03)",border:"1px solid #1a2a1a",borderRadius:10,padding:"10px 16px",display:"flex",flexDirection:"column",alignItems:"center",gap:2,flex:1,minWidth:70}}>
                      <span style={{fontSize:18}}>{h.icon}</span>
                      <span style={{fontSize:18,fontWeight:700,color:"#00ffb4"}}>{h.val}</span>
                      <span style={{fontSize:10,color:"#555",letterSpacing:1}}>{h.lbl}</span>
                    </div>
                  ))}
                  {lockout>0&&<div style={{background:"rgba(239,68,68,.1)",border:"1px solid #ef4444",borderRadius:10,padding:"10px 16px",display:"flex",flexDirection:"column",alignItems:"center",gap:2,flex:1,minWidth:70}}>
                    <span style={{fontSize:18}}>🔒</span>
                    <span style={{fontSize:18,fontWeight:700,color:"#f87171"}}>{Math.ceil(lockout/60)}m</span>
                    <span style={{fontSize:10,color:"#f87171",letterSpacing:1}}>LOCKED</span>
                  </div>}
                </div>

                {/* Progress */}
                <div style={{position:"relative",height:6,background:"#1a1a1a",borderRadius:3,marginBottom:28}}>
                  <div style={{position:"absolute",left:0,top:0,height:"100%",width:`${progressPct}%`,borderRadius:3,background:"linear-gradient(90deg,#00ffb4,#0ea5e9)",transition:"width .4s ease"}}/>
                </div>

                {/* Level card */}
                <div style={{border:`1px solid ${diffStyle.border}`,borderRadius:16,padding:28,background:`linear-gradient(135deg,${diffStyle.bg} 0%,#0a0a0f 100%)`}}>
                  <div style={{marginBottom:20}}>
                    <span style={{border:`1px solid ${diffStyle.border}`,borderRadius:6,padding:"3px 10px",fontSize:11,letterSpacing:2,fontWeight:700,color:diffStyle.text,background:diffStyle.bg,marginRight:12}}>{lvl.difficulty.toUpperCase()}</span>
                    <span style={{color:"#555",fontSize:13,letterSpacing:2}}>LEVEL {currentLevel+1} / 10</span>
                    <div style={{color:"#e2e8f0",fontSize:18,fontWeight:700,marginTop:8}}>{lvl.topic}</div>
                  </div>

                  <div style={{background:"rgba(0,0,0,.4)",border:"1px solid #1a1a2a",borderRadius:10,padding:"16px 20px",marginBottom:16}}>
                    <pre style={{color:"#94a3b8",fontSize:14,lineHeight:1.8,whiteSpace:"pre-wrap",fontFamily:"'Courier New',monospace",margin:0}}>{HINTS[currentLevel]}</pre>
                  </div>

                  {partialHint&&<div style={{background:"rgba(250,204,21,.07)",border:"1px solid #713f12",borderRadius:8,padding:"10px 16px",marginBottom:16,color:"#fde68a",fontSize:13}}>{partialHint}</div>}

                  {wrongOnLevel>0&&(
                    <div style={{display:"flex",gap:6,alignItems:"center",marginBottom:16,flexWrap:"wrap"}}>
                      {Array.from({length:5}).map((_,i)=>(
                        <div key={i} style={{width:28,height:28,borderRadius:6,background:i<wrongOnLevel?"#ef4444":"#1a1a1a",border:`1px solid ${i<wrongOnLevel?"#dc2626":"#333"}`,display:"flex",alignItems:"center",justifyContent:"center",fontSize:14}}>{i<wrongOnLevel?"✗":"○"}</div>
                      ))}
                      <span style={{color:"#f87171",fontSize:12,marginLeft:8}}>{5-wrongOnLevel} attempts before lockout</span>
                    </div>
                  )}

                  <div style={{display:"flex",gap:10,marginBottom:12}}>
                    <input
                      style={{flex:1,background:"rgba(0,0,0,.5)",border:"1px solid #334",borderRadius:10,padding:"14px 16px",color:"#e2e8f0",fontSize:16,fontFamily:"'Courier New',monospace",opacity:lockout>0?.5:1}}
                      placeholder={lockout>0?`🔒 Locked — ${Math.ceil(lockout/60)}m`:"Type your answer…"}
                      value={answer}
                      onChange={e=>setAnswer(e.target.value)}
                      onKeyDown={e=>e.key==="Enter"&&!lockout&&handleSubmit()}
                      disabled={lockout>0}
                    />
                    <button onClick={handleSubmit} disabled={lockout>0||!!loading} style={{background:lockout>0?"#333":diffStyle.border,border:"none",color:"#050508",fontWeight:700,padding:"14px 24px",borderRadius:10,fontSize:14,cursor:lockout>0?"not-allowed":"pointer",fontFamily:"'Courier New',monospace",opacity:loading?.6:1}}>
                      {loading?"⏳":"Submit ↵"}
                    </button>
                  </div>

                  <div style={{display:"flex",alignItems:"center",justifyContent:"space-between",flexWrap:"wrap",gap:8}}>
                    <button onClick={handleHint} disabled={hintTokens<=0||!!loading} style={{background:"rgba(250,204,21,.08)",border:"1px solid #713f12",color:"#fde68a",padding:"8px 16px",borderRadius:8,fontSize:12,fontFamily:"'Courier New',monospace",cursor:hintTokens>0?"pointer":"not-allowed",opacity:hintTokens>0?1:.4}}>
                      💡 Use Hint Token ({hintTokens} left)
                    </button>
                    <span style={{color:"#555",fontSize:12}}>Case insensitive ✓</span>
                  </div>

                  {feedback&&<div style={{border:"1px solid",borderRadius:10,padding:"12px 16px",marginTop:12,fontSize:14,animation:"fadeIn .3s ease",background:feedback.type==="ok"?"rgba(0,255,180,.1)":"rgba(239,68,68,.1)",borderColor:feedback.type==="ok"?"#00ffb4":"#ef4444",color:feedback.type==="ok"?"#00ffb4":"#f87171"}}>{feedback.msg}</div>}
                </div>
              </>
            )}
          </div>
        )}

        {/* LEADERBOARD */}
        {page==="leaderboard" && (
          <div>
            <div style={{color:"#555",fontSize:11,letterSpacing:4,marginBottom:16,borderBottom:"1px solid #111",paddingBottom:8}}>📊 LIVE LEADERBOARD</div>
            <div style={{background:"rgba(255,255,255,.02)",border:"1px solid #1a2a1a",borderRadius:12,overflow:"hidden",marginBottom:32}}>
              <div style={{display:"flex",padding:"12px 20px",background:"rgba(0,255,180,.05)",borderBottom:"1px solid #1a2a1a",fontSize:11,color:"#555",letterSpacing:2}}>
                <span style={{width:40}}>#</span><span style={{flex:1}}>Player</span><span style={{width:80,textAlign:"center"}}>Level</span><span style={{width:100,textAlign:"right"}}>Score</span><span style={{width:80,textAlign:"right"}}>Wrongs</span><span style={{width:60,textAlign:"center"}}>Status</span>
              </div>
              {leaderboard.length===0
                ? <div style={{padding:40,textAlign:"center",color:"#555"}}>No players yet — be the first!</div>
                : leaderboard.sort((a,b)=>b.score-a.score).map((p,i)=>(
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
      </main>

      <footer style={{textAlign:"center",padding:"20px 24px",borderTop:"1px solid #0d1117",fontSize:12,color:"#333",position:"relative",zIndex:1}}>
        CipherChain · Sepolia Testnet · Hania · Manahil Tanweer · Menahil Fatima · Zoya Khan
      </footer>
    </div>
  );
}