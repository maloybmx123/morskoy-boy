const $=id=>document.getElementById(id);
let socket=null, room=null, me=null, board=[], shots=[], selectedTarget=null, rotation='h', placementShips=[], placedShips=[], nextShipId=1, logs=[];
const show=(id,on=true)=>$(id).classList.toggle('hidden',!on);
function toast(msg){$('toast').textContent=msg;show('toast');clearTimeout(toast.t);toast.t=setTimeout(()=>show('toast',false),3000)}
function send(obj){if(!socket||socket.readyState!==WebSocket.OPEN)return toast('Нет соединения с сервером.');socket.send(JSON.stringify(obj))}
function fleetFromUI(size){
 const preset=$('fleetPreset').value;
 if(preset==='classic') return size>=10?[4,3,3,2,2,2,1,1,1,1]:size>=8?[3,2,2,1,1,1]:[3,2,1,1];
 if(preset==='small') return size>=10?[3,2,2,1,1]:[2,2,1,1];
 const a=$('fleetText').value.split(',').map(v=>parseInt(v.trim(),10));
 if(!a.length||a.some(v=>!Number.isInteger(v)||v<1||v>size)||a.length>20) throw Error('Проверь длины кораблей.');
 return a;
}
function connect(){return new Promise((resolve,reject)=>{
 const proto=location.protocol==='https:'?'wss:':'ws:';
 socket=new WebSocket(`${proto}//${location.host}`);
 socket.onopen=()=>resolve(); socket.onerror=()=>reject(Error('Не удалось подключиться к серверу.'));
 socket.onmessage=e=>{let m;try{m=JSON.parse(e.data)}catch{return}
 if(m.type==='error')toast(m.text);
 if(m.type==='notice'){logs.unshift(m.text);logs=logs.slice(0,20);renderLog()}
 if(m.type==='state'){room=m.room;me=m.you;renderState()}
 };
 socket.onclose=()=>{if(room)toast('Соединение потеряно. Обнови страницу, чтобы подключиться снова.');};
})}
async function connectAction(type){
 try{if(!socket||socket.readyState!==WebSocket.OPEN)await connect();
 if(type==='create'){
  const size=+$('size').value, fleet=fleetFromUI(size);
  send({type:'create',name:$('name').value,size,maxPlayers:+$('maxPlayers').value,fleet,extraShot:$('extraShot').checked});
 }else send({type:'join',name:$('name').value,code:$('roomCode').value.trim().toUpperCase()});
 }catch(e){toast(e.message+' Запусти сервер или открой размещённую версию игры.')}
}
$('createBtn').onclick=()=>connectAction('create');
$('joinBtn').onclick=()=>connectAction('join');
$('fleetPreset').onchange=()=>show('customFleet',$('fleetPreset').value==='custom');
$('copyBtn').onclick=async()=>{try{await navigator.clipboard.writeText(room.code);toast('Код комнаты скопирован.')}catch{toast('Код комнаты: '+room.code)}};
$('rotateBtn').onclick=()=>{rotation=rotation==='h'?'v':'h';$('rotateBtn').textContent=rotation==='h'?'↻ Горизонтально':'↻ Вертикально'};
$('autoBtn').onclick=autoPlace;
$('clearBtn').onclick=()=>{board=emptyBoard(room.settings.size);placedShips=[];placementShips=[...room.settings.fleet].sort((a,b)=>b-a);nextShipId=1;renderOwnBoard(true);renderFleetStatus()};
$('shipSelect').onchange=()=>{};
$('readyBtn').onclick=()=>{
 if(placementShips.length){toast('Сначала расставь весь флот.');return}
 send({type:'ready',board});$('readyBtn').disabled=true;
};
function emptyBoard(n){return Array.from({length:n},()=>Array(n).fill(0))}
function autoPlace(){
 if(!room)return;
 const n=room.settings.size; board=emptyBoard(n);placedShips=[];placementShips=[...room.settings.fleet].sort((a,b)=>b-a);nextShipId=1;
 for(const len of placementShips){
  let done=false;
  for(let tries=0;tries<1000&&!done;tries++){
   const horizontal=Math.random()<.5, x=Math.floor(Math.random()*(horizontal?n-len+1:n)), y=Math.floor(Math.random()*(horizontal?n:n-len+1));
   const cells=Array.from({length:len},(_,i)=>[x+(horizontal?i:0),y+(horizontal?0:i)]);
   if(cells.every(([cx,cy])=>board[cy][cx]===0)){
    cells.forEach(([cx,cy])=>board[cy][cx]=nextShipId);placedShips.push({id:nextShipId,len,cells});nextShipId++;done=true;
   }
  }
  if(!done){toast('Не удалось разместить флот. Попробуй ещё раз.');return}
 }
 placementShips=[];renderOwnBoard(true);renderFleetStatus();
}
function placeAt(x,y){
 if(!placementShips.length)return;
 const len=+$('shipSelect').value||placementShips[0], n=room.settings.size;
 const cells=Array.from({length:len},(_,i)=>[x+(rotation==='h'?i:0),y+(rotation==='v'?i:0)]);
 if(cells.some(([cx,cy])=>cx<0||cy<0||cx>=n||cy>=n||board[cy][cx]!==0)){toast('Корабль не помещается или клетка занята.');return}
 cells.forEach(([cx,cy])=>board[cy][cx]=nextShipId);placedShips.push({id:nextShipId,len,cells});nextShipId++;
 const idx=placementShips.indexOf(len);if(idx>=0)placementShips.splice(idx,1);
 updateShipSelect();renderOwnBoard(true);renderFleetStatus();
}
function updateShipSelect(){
 const s=$('shipSelect'),old=+s.value;s.innerHTML='';
 [...new Set(placementShips)].forEach(len=>{const o=document.createElement('option');o.value=len;o.textContent=`Корабль: ${len}`;s.append(o)});
 if([...s.options].some(o=>+o.value===old))s.value=old;
}
function renderFleetStatus(){$('fleetStatus').textContent=placementShips.length?`Осталось расставить: ${placementShips.join(', ')} палуб(ы).`:'Флот готов! Нажми «Готов к бою» и дождись остальных.';$('readyBtn').disabled=placementShips.length>0||me?.ready}
function renderBoard(el,grid,mode,clickable=false){
 const n=grid.length;el.innerHTML='';const b=document.createElement('div');b.className='board';b.style.gridTemplateColumns=`repeat(${n},minmax(0,1fr))`;
 for(let y=0;y<n;y++)for(let x=0;x<n;x++){
  const c=document.createElement('button');c.className='cell';c.type='button';const v=grid[y][x];
  if(mode==='own'&&v){c.classList.add('ship');c.textContent='▰'}
  if(mode==='enemy'){
   if(v==='hit'){c.classList.add('hit');c.textContent='✕'}
   else if(v==='miss'){c.classList.add('miss');c.textContent='·'}
  }
  c.setAttribute('aria-label',`Строка ${y+1}, столбец ${x+1}`);
  if(clickable){c.classList.add('selectable');c.onclick=()=>placeAt(x,y)}
  else if(mode==='enemy'&&room?.status==='playing'&&me?.id===room.players[room.turn]?.id&&selectedTarget&&grid[y][x]===null){
   c.classList.add('selectable');c.onclick=()=>send({type:'shot',target:selectedTarget,x,y});
  }else c.disabled=true;
  b.append(c);
 }
 el.append(b);
}
function renderOwnBoard(edit=false){if(!room)return;renderBoard($('ownBoard'),board,'own',edit&&!me?.ready);if(!edit)renderBoard($('myBoard'),board,'own',false)}
function renderState(){
 if(!room||!me)return;
 show('setup',false);show('lobby',room.status==='lobby');show('game',room.status==='playing'||room.status==='finished');
 $('roomCodeShow').textContent=room.code;$('gameCode').textContent=room.code;
 $('roomDescription').textContent=`Поле ${room.settings.size}×${room.settings.size} · до ${room.settings.maxPlayers} игроков · ${room.settings.extraShot?'попадание даёт дополнительный выстрел':'по одному выстрелу за ход'}`;
 if(!board.length||board.length!==room.settings.size){board=me.board||emptyBoard(room.settings.size);placementShips=[...room.settings.fleet].sort((a,b)=>b-a);placedShips=[];nextShipId=1;updateShipSelect()}
 if(me.board)board=me.board;
 const roster=room.players.map(p=>`<div class="player ${room.status==='playing'&&room.players[room.turn]?.id===p.id?'active':''}"><span>${escapeHtml(p.name)}${p.id===me.id?' (ты)':''}</span><span class="status">${p.ready?'Готов':p.alive?'На борту':'Потоплен'}</span></div>`).join('');
 $('players').innerHTML=roster;$('scoreboard').innerHTML=roster;
 renderOwnBoard(room.status==='lobby'&&!me.ready);renderFleetStatus();
 if(room.status==='lobby'){
  $('readyBtn').disabled=me.ready||placementShips.length>0;
  $('readyBtn').textContent=me.ready?'Ты готов ✓':'Готов к бою';
 }else{
  const current=room.players[room.turn];
  $('turnStatus').textContent=room.status==='finished'?'🏆 Бой завершён':current?.id===me.id?'🎯 Твой ход':`Ход: ${current?.name||'—'}`;
  const targets=room.players.filter(p=>p.id!==me.id&&p.alive);
  if(!selectedTarget||!targets.some(p=>p.id===selectedTarget))selectedTarget=targets[0]?.id||null;
  $('targets').innerHTML=targets.map(p=>`<button class="target ${p.id===selectedTarget?'selected':''}" data-id="${p.id}">${escapeHtml(p.name)}<br><small>${p.shipsLeft} палуб осталось</small></button>`).join('');
  $('targets').querySelectorAll('button').forEach(b=>b.onclick=()=>{selectedTarget=b.dataset.id;renderState()});
  const target=room.players.find(p=>p.id===selectedTarget);
  $('targetTitle').textContent=target?`Поле противника: ${target.name}`:'Нет доступных противников';
  if(target){const view=target.shots;renderBoard($('enemyBoard'),view,'enemy',false);if(room.status==='playing'&&current?.id===me.id)wireEnemyCells(view)}
  else $('enemyBoard').innerHTML='<p class="muted">Все противники выбыли.</p>';
 }
 renderLog();
}
function wireEnemyCells(view){
 const b=$('enemyBoard').querySelector('.board');if(!b)return;
 [...b.children].forEach((c,i)=>{const y=Math.floor(i/view.length),x=i%view.length;if(view[y][x]===null&&room.status==='playing'&&room.players[room.turn]?.id===me.id){c.disabled=false;c.classList.add('selectable');c.onclick=()=>send({type:'shot',target:selectedTarget,x,y})}})
}
function renderLog(){$('log').textContent=logs.join('\n')||'Сообщения о ходе боя появятся здесь.'}
function escapeHtml(s){return String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]))}
