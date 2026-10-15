const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const WebSocket = require('ws');

const PORT = process.env.PORT || 8080;
const ROOT = __dirname;
const rooms = new Map();
const mime = {'.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8','.json':'application/json; charset=utf-8','.svg':'image/svg+xml'};

const server = http.createServer((req,res) => {
  let pathname = decodeURIComponent((req.url || '/').split('?')[0]);
  if (pathname === '/') pathname = '/index.html';
  const full = path.join(ROOT, pathname);
  if (!full.startsWith(ROOT)) { res.writeHead(403); return res.end('Forbidden'); }
  fs.readFile(full, (err,data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, {'Content-Type': mime[path.extname(full)] || 'application/octet-stream', 'Cache-Control':'no-store'});
    res.end(data);
  });
});
const wss = new WebSocket.Server({server});
const send = (ws,obj) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(obj)); };
const broadcast = (room,obj) => room.players.forEach(p => send(p.ws,obj));
const code = () => crypto.randomBytes(3).toString('hex').toUpperCase();
const safeRoom = room => ({
  code: room.code, status: room.status, settings: room.settings, turn: room.turn,
  players: room.players.map(p => ({id:p.id,name:p.name,ready:p.ready,alive:p.alive,shipsLeft:p.shipsLeft})),
  board: room.status === 'playing' ? room.players.map(p => ({id:p.id,shots:p.shots})) : undefined,
  winner: room.winner || null
});
function privateState(room, player) {
  return {type:'state', room:safeRoom(room), you:{id:player.id, board:player.board, shots:player.shots, ready:player.ready}};
}
function pushStates(room) { room.players.forEach(p => send(p.ws, privateState(room,p))); }
function tell(room,text) { broadcast(room,{type:'notice',text}); }
function error(ws,text) { send(ws,{type:'error',text}); }
function validBoard(board,n) {
  if (!Array.isArray(board) || board.length !== n || board.some(r=>!Array.isArray(r)||r.length!==n)) return false;
  const ships = new Map();
  for(let y=0;y<n;y++) for(let x=0;x<n;x++) {
    const v=board[y][x];
    if (v !== 0 && (!Number.isInteger(v)||v<1||v>20)) return false;
    if(v) ships.set(v,(ships.get(v)||0)+1);
  }
  if (!ships.size || [...ships.values()].some(s=>s<1||s>n)) return false;
  // Each ship id must form a straight contiguous line; touching is allowed.
  for(const [id] of ships) {
    const cells=[];
    for(let y=0;y<n;y++) for(let x=0;x<n;x++) if(board[y][x]===id) cells.push([x,y]);
    const sameX=cells.every(c=>c[0]===cells[0][0]), sameY=cells.every(c=>c[1]===cells[0][1]);
    if(!sameX&&!sameY) return false;
    const vals=cells.map(c=>sameX?c[1]:c[0]).sort((a,b)=>a-b);
    if(vals.some((v,i)=>i>0&&v!==vals[i-1]+1)) return false;
  }
  return true;
}
function startIfReady(room) {
  if(room.players.length>=2 && room.players.every(p=>p.ready) && room.status==='lobby') {
    room.status='playing'; room.turn=0;
    tell(room,'Бой начался! Первым стреляет '+room.players[room.turn].name+'.');
    pushStates(room);
  }
}
wss.on('connection', ws => {
  ws.on('message', raw => {
    let m; try { m=JSON.parse(raw.toString()); } catch { return error(ws,'Не удалось прочитать сообщение.'); }
    if(!m || typeof m.type!=='string') return;
    if(m.type==='create') {
      const n=Math.max(6,Math.min(20,Number(m.size)||10));
      const maxPlayers=Math.max(2,Math.min(8,Number(m.maxPlayers)||4));
      const fleet=Array.isArray(m.fleet)?m.fleet.map(Number).filter(x=>Number.isInteger(x)&&x>=1&&x<=n).slice(0,20):[4,3,3,2,2,2,1,1,1,1];
      if(fleet.reduce((a,b)=>a+b,0)>n*n/2) return error(ws,'Флот слишком велик для выбранного поля.');
      let c; do { c=code(); } while(rooms.has(c));
      const room={code:c,status:'lobby',settings:{size:n,maxPlayers,fleet,extraShot:m.extraShot!==false},players:[],turn:0,winner:null};
      rooms.set(c,room); joinRoom(ws,room,m.name); return;
    }
    if(m.type==='join') {
      const room=rooms.get(String(m.code||'').toUpperCase());
      if(!room) return error(ws,'Комната не найдена. Проверь код.');
      if(room.status!=='lobby') return error(ws,'Игра уже началась — присоединиться поздно.');
      if(room.players.length>=room.settings.maxPlayers) return error(ws,'В комнате уже нет свободных мест.');
      joinRoom(ws,room,m.name); return;
    }
    const room=ws.room, player=ws.player;
    if(!room||!player) return error(ws,'Сначала создай комнату или подключись к ней.');
    if(m.type==='ready') {
      if(room.status!=='lobby') return;
      if(!validBoard(m.board,room.settings.size)) return error(ws,'Поле кораблей некорректно. Расставь флот заново.');
      const counts=new Map(); for(const row of m.board) for(const v of row) if(v) counts.set(v,(counts.get(v)||0)+1);
      const sizes=[...counts.values()].sort((a,b)=>b-a), expected=[...room.settings.fleet].sort((a,b)=>b-a);
      if(sizes.length!==expected.length || sizes.some((v,i)=>v!==expected[i])) return error(ws,'Состав кораблей не совпадает с настройками комнаты.');
      player.board=m.board; player.ready=true;
      tell(room,player.name+' готов к бою.');
      startIfReady(room); pushStates(room); return;
    }
    if(m.type==='shot') {
      if(room.status!=='playing') return error(ws,'Игра ещё не началась.');
      if(room.players[room.turn]!==player) return error(ws,'Сейчас ход другого игрока.');
      const x=Number(m.x), y=Number(m.y), target=room.players.find(p=>p.id===m.target);
      if(!target||target===player||!target.alive) return error(ws,'Выбери живого противника.');
      const n=room.settings.size;
      if(!Number.isInteger(x)||!Number.isInteger(y)||x<0||y<0||x>=n||y>=n) return error(ws,'Клетка вне поля.');
      if(target.shots[y][x]!==null) return error(ws,'В эту клетку уже стреляли.');
      const hit=target.board[y][x]!==0;
      target.shots[y][x]=hit?'hit':'miss';
      let sunk=false;
      if(hit) {
        const id=target.board[y][x];
        sunk=true;
        for(let yy=0;yy<n;yy++) for(let xx=0;xx<n;xx++) if(target.board[yy][xx]===id && target.shots[yy][xx]!=='hit') sunk=false;
      }
      const shipsLeft=target.board.flat().filter(v=>v!==0).length-target.shots.flat().filter(v=>v==='hit').length;
      target.shipsLeft=shipsLeft;
      if(shipsLeft===0) {
        target.alive=false;
        tell(room,player.name+' уничтожил весь флот игрока '+target.name+'!');
      } else {
        tell(room,player.name+(hit?' попал!':' промахнулся.')+(sunk?' Корабль уничтожен.':''));
      }
      const living=room.players.filter(p=>p.alive);
      if(living.length===1) {
        room.status='finished'; room.winner=living[0].id;
        tell(room,'Победитель: '+living[0].name+'! Игра окончена.');
      } else if(!hit || !room.settings.extraShot) {
        let idx=room.turn;
        do { idx=(idx+1)%room.players.length; } while(!room.players[idx].alive);
        room.turn=idx;
        tell(room,'Теперь стреляет '+room.players[room.turn].name+'.');
      } else tell(room,'Попадание — дополнительный выстрел игрока '+player.name+'.');
      pushStates(room); return;
    }
    if(m.type==='leave') { leave(ws); return; }
  });
  ws.on('close',()=>leave(ws));
  ws.on('error',()=>leave(ws));
});
function joinRoom(ws,room,name) {
  name=String(name||'Игрок').trim().slice(0,24)||'Игрок';
  const p={id:crypto.randomBytes(8).toString('hex'),name,ws,ready:false,alive:true,board:null,shots:Array.from({length:room.settings.size},()=>Array(room.settings.size).fill(null)),shipsLeft:0};
  room.players.push(p); ws.room=room; ws.player=p;
  tell(room,name+' подключился к комнате.');
  pushStates(room);
}
function leave(ws) {
  const room=ws.room,p=ws.player; if(!room||!p) return;
  room.players=room.players.filter(x=>x!==p); ws.room=null; ws.player=null;
  if(room.players.length===0) rooms.delete(room.code);
  else {
    if(room.status==='playing') {
      p.alive=false;
      const alive=room.players.filter(x=>x.alive);
      if(alive.length===1) { room.status='finished'; room.winner=alive[0].id; tell(room,'Победитель: '+alive[0].name+'!'); }
      else if(room.players.indexOf(room.players[room.turn])<0 || room.players[room.turn]===undefined) room.turn=0;
    }
    tell(room,p.name+' отключился.');
    pushStates(room);
  }
}
server.listen(PORT,()=>console.log(`Морской бой запущен: http://localhost:${PORT}`));
