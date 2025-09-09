/* AI-first MVP · App-Logik + EFA (Erweiterter Fehlercode-Assistent) */
(function(){
  // --- Statuschips ---
  function setChip(id, state){ // state: ok|warn|err|unset
    const el = document.getElementById(id);
    el.classList.remove('ok','warn','err');
    if(state) el.classList.add(state);
  }
  function updateStatusChips(env){
    if(!env) return;
    const area = (env.code||'').split('-')[0];
    const map = { APP:'chip-compute', CONF:'chip-compute', DATA:'chip-data', POLICY:'chip-policy', AI:'chip-ai', COMPUTE:'chip-compute', UI:'chip-compute', PERM:'chip-data' };
    const chip = map[area];
    if(!chip) return;
    const st = env.severity==='S1' ? 'err' : (env.severity==='S2' ? 'warn' : 'ok');
    setChip(chip, st);
  }

  function showInlineError(env){
    const wrap = document.getElementById('alerts');
    const div = document.createElement('div');
    div.className = 'alert';
    div.innerHTML = `<div><strong>${escapeHtml(env.title)}</strong><br><span class="meta">${escapeHtml(env.code)} · ${escapeHtml(env.detail)}</span></div>
    <div class="actions">
      ${ (env.user_action||[]).map(a=>`<button class="btn">${escapeHtml(a)}</button>`).join('') }
    </div>`;
    wrap.prepend(div);
  }

  const EFA = {
    log: [],
    push(e){ this.log.push(Object.assign({ts:new Date().toISOString()}, e)); if(this.log.length>50) this.log.shift(); updateStatusChips(e); },
    ok(code, ctx={}){ this.push({code, severity:'S3', title:'OK', detail:'', context:ctx}); },
    err(code, title, detail, severity='S2', context={}, actions=[]){
      const env = {code, severity, title, detail, context, user_action:actions, trace_id:crypto.randomUUID()};
      this.push(env); showInlineError(env); return env;
    }
  };

  async function guard(label, fn, {timeoutMs=3000, fallback=()=>null, onError}={}){
    const to = new Promise((_,rej)=>setTimeout(()=>rej(new Error('timeout')), timeoutMs));
    try { const res = await Promise.race([Promise.resolve().then(fn), to]); return res; }
    catch(err){
      const env = EFA.err(`${label}-TIMEOUT-408`, `${label} Timeout`, String(err&&err.message||err), 'S2', {module:label});
      if(onError) onError(env);
      return fallback();
    }
  }

  // --- Regeln (eingebettet + optional extern laden) ---
  const EMBEDDED_RULES = {
    meta:{version:'2025-09-01'},
    fuel:{reserve_can:{max_liters:20, rule_id:'FUEL-RCAN-20'}},
    categories:{
      cigarettes:{unit:'pieces', per_person:800, pack_size:20, rule_id:'TOB-CIG-800', priv_rule:'TOB-PRIV-1'},
      beer:{unit:'liters', per_person:110, rule_id:'ALC-BEER-110'},
      spirits:{unit:'liters', per_person:10, rule_id:'ALC-SPIR-10'}
    },
    rounding:{beer_bottle_l:0.5, spirits_bottle_l:0.7}
  };
  let RULES = EMBEDDED_RULES;

  async function loadRules(){
    try{
      const res = await fetch('rules/customs_rules.json', {cache:'no-store'});
      if(!res.ok) throw new Error('HTTP '+res.status);
      const json = await res.json();
      if(!json.meta || !json.meta.version) throw new Error('missing meta.version');
      RULES = json;
      document.getElementById('rulesVersion').textContent = 'v'+RULES.meta.version;
      EFA.ok('POLICY-OK-200', {version:RULES.meta.version});
    }catch(e){
      RULES = EMBEDDED_RULES;
      document.getElementById('rulesVersion').textContent = 'v'+RULES.meta.version+' (Fallback)';
      EFA.err('POLICY-LOAD-400','Regeln konnten nicht geladen werden', String(e), 'S2', {url:'rules/customs_rules.json'}, ['Nutze eingebettete Defaults']);
    }
  }

  // --- KI-Erklärung (Stub + Fallback) ---
  async function explainWithAI(facts){
    // Kein externer Aufruf im MVP: wir simulieren gelegentlich einen Ausfall, um EFA zu demonstrieren.
    const fail = false; // auf true setzen, um Timeout zu testen
    return guard('AI-ADVISOR', async ()=>{
      if(fail) await new Promise(res=>setTimeout(res, 4000)); // Timeout
      return templateExplain(facts);
    },{
      fallback: ()=>templateExplain(facts),
      onError: (env)=>{} // UI wird in computeAll aktualisiert
    });
  }

  function templateExplain(f){
    const ruleBeer = RULES.categories.beer.rule_id;
    const ruleSpir = RULES.categories.spirits.rule_id;
    const lines = [];
    if(f.status==='good'){
      lines.push(`Lohnt sich: +${fmt2(f.net)} € (${fmt2(f.perHour)} €/h). Zoll: konform.`);
      lines.push(`Aktion: ${f.action || 'Behalte Mengen bei und tanke vor Ort voll.'}`);
    }else if(f.status==='warn'){
      lines.push(`Knapp: +${fmt2(f.net)} €. ${f.warn || 'Nahe an einer Richtmenge.'}`);
      lines.push(`Aktion: ${f.action || 'Reduziere knappe Position auf Grenze (z. B. Bier; Rule '+ruleBeer+').'}`);
    }else{
      lines.push(`Lohnt nicht: ${fmt2(f.net)} €.`);
      lines.push(`Aktion: ${f.action || 'Wechsle Fahrzeug oder reduziere Distanz/Mengen.'}`);
    }
    return lines.join(' ');
  }

  // --- UI Setup ---
  const vehicles = [
    { id:'thomas', name:'Dein Benzin (6.4 l/100)', fuelType:'e5', l_per_100km:6.4, fixedCostEUR:0 },
    { id:'kollege', name:'Kollege Diesel (5.2 l/100)', fuelType:'diesel', l_per_100km:5.2, fixedCostEUR:0 }
  ];

  document.addEventListener('DOMContentLoaded', async ()=>{
    const sel = $('#vehicle');
    vehicles.forEach(v=>{ const o=document.createElement('option'); o.value=v.id; o.textContent=v.name; sel.appendChild(o); });
    sel.value = vehicles[0].id;
    addHandlers();
    await loadRules();
  });

  function addHandlers(){
    $('#calc').addEventListener('click', computeAll);
    $('#simulate').addEventListener('click', simulateP80);
    $('#applyPatch').addEventListener('click', ()=>applyPatch(currentPatch));
  }

  // --- Helpers ---
  const $ = s => document.querySelector(s);
  const setText = (sel, v) => $(sel).textContent = v;
  function readNumber(id){ const n = parseFloat($(id).value); return Number.isFinite(n)?n:0; }
  function getVehicle(){ const id = $('#vehicle').value; return vehicles.find(v=>v.id===id)||vehicles[0]; }
  function fmt2(x){ return Number(x).toFixed(2); }
  function escapeHtml(s){return String(s).replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;"}[m]));}

  let currentPatch = null;

  // --- Core compute ---
  function computeAll(){
    try{
      // Mark compute start
      setChip('chip-compute','ok');

      const persons = Math.max(1, Math.floor(readNumber('#persons')));
      const v = getVehicle();
      const distanceKm = Math.max(1, readNumber('#distanceKm'));
      const avgSpeed = Math.max(30, readNumber('#avgSpeed'));
      if(avgSpeed<=0) throw new Error('avgSpeed<=0');

      const fuelDE = readNumber('#fuelDE');
      const fuelCZ = readNumber('#fuelCZ');
      const fixedCost = Math.max(0, readNumber('#fixedCost'));
      const timeValue = Math.max(0, readNumber('#timeValue'));

      const fuelTopUpL = Math.max(0, readNumber('#fuelTopUpL'));
      const reserveL = Math.max(0, readNumber('#reserveL'));
      const beerL = Math.max(0, readNumber('#beerL'));
      const spiritsL = Math.max(0, readNumber('#spiritsL'));
      const cigCartons = Math.max(0, Math.floor(readNumber('#cigCartons')));
      const cigExternal = $('#cigExternal').checked;

      const beerCZ = readNumber('#beerCZ'), beerDE = readNumber('#beerDE');
      const spiritsCZ = readNumber('#spiritsCZ'), spiritsDE = readNumber('#spiritsDE');
      const cigCZ = readNumber('#cigCZ'), cigDE = readNumber('#cigDE');
      const foodCZsum = Math.max(0, readNumber('#foodCZsum'));
      const foodDEsum = Math.max(0, readNumber('#foodDEsum'));

      const mealInROI = $('#mealROI').value==='yes';
      const mealCost = Math.max(0, readNumber('#mealCost'));

      // Fahrtkosten (vereinfachtes Modell): Verbrauch × Distanz × DE‑Preis + Fixkosten
      const travelFuelL = distanceKm * v.l_per_100km / 100;
      const travelFuelCost = travelFuelL * fuelDE; // konservativ: DE‑Preis
      const costTotal = travelFuelCost + fixedCost + (mealInROI?mealCost:0);

      // Ersparnisse
      const fuelSaving = (fuelTopUpL + reserveL) * Math.max(0, fuelDE - fuelCZ);
      const beerSaving = beerL * Math.max(0, beerDE - beerCZ);
      const spiritsSaving = spiritsL * Math.max(0, spiritsDE - spiritsCZ);
      const cigPacks = cigCartons * 10; // 10 Packs je Stange
      const cigSaving = cigPacks * Math.max(0, cigDE - cigCZ);
      const foodSaving = Math.max(0, foodDEsum - foodCZsum);

      const goodsSaving = fuelSaving + beerSaving + spiritsSaving + cigSaving + foodSaving;

      // Compliance
      const findings = [];
      const rules = RULES.categories;
      if (reserveL > EMBEDDED_RULES.fuel.reserve_can.max_liters) {
        findings.push({status:'warn', ruleId: EMBEDDED_RULES.fuel.reserve_can.rule_id, message:`Reservekanister ${reserveL} L > ${EMBEDDED_RULES.fuel.reserve_can.max_liters} L`});
      }
      const beerLimit = persons * rules.beer.per_person;
      if (beerL > beerLimit) findings.push({status: 'warn', ruleId: rules.beer.rule_id, message:`Bier ${beerL} L > ${beerLimit} L`});
      const spiritsLimit = persons * rules.spirits.per_person;
      if (spiritsL > spiritsLimit) findings.push({status: 'warn', ruleId: rules.spirits.rule_id, message:`Spirituosen ${spiritsL} L > ${spiritsLimit} L`});
      const cigLimitPacks = persons * (rules.cigarettes.per_person / rules.cigarettes.pack_size);
      if (cigPacks > cigLimitPacks) findings.push({status:'warn', ruleId: rules.cigarettes.rule_id, message:`Zigaretten ${cigPacks} Pck. > ${Math.floor(cigLimitPacks)} Pck.`});
      if (cigExternal && cigPacks>0) findings.push({status:'warn', ruleId: rules.cigarettes.priv_rule, message:`Zigaretten für Kollegen (nicht anwesend) → Privatbedarf fraglich`});

      const worst = findings.some(f=>f.status==='warn') ? 'warn' : 'ok';

      const net = +(goodsSaving - costTotal).toFixed(2);
      const travelTimeH = distanceKm / avgSpeed;
      const netPerHour = +(net / travelTimeH).toFixed(2);

      // Ampel
      let ampelClass = 'warn', badge='Knapp';
      if (net >= 5) { ampelClass='good'; badge='Lohnt sich'; }
      else if (net <= -5) { ampelClass='bad'; badge='Lohnt nicht'; }

      const ampel = document.getElementById('ampel');
      ampel.classList.remove('good','warn','bad'); ampel.classList.add(ampelClass);
      setText('#ampelBadge', badge);
      setText('#net', `${net.toFixed(2)} € Netto`);
      setText('#perh', `≈ ${isFinite(netPerHour)?netPerHour.toFixed(2):'–'} €/h`);
      const ctext = findings.length===0 ? `Konform ✅` : findings.map(f=>`(${f.ruleId}) ${f.message}`).join(' • ');
      setText('#customsText', ctext);
      setText('#rulesMeta', `Regelwerk ${RULES.meta && RULES.meta.version ? 'v'+RULES.meta.version : '(embedded)'}`);

      // Nächste beste Aktion
      currentPatch = null;
      const patches = [];
      if (reserveL > EMBEDDED_RULES.fuel.reserve_can.max_liters) {
        patches.push({ label:`Reservekanister auf ${EMBEDDED_RULES.fuel.reserve_can.max_liters} L setzen`, patch:{ reserveL: EMBEDDED_RULES.fuel.reserve_can.max_liters } });
      }
      if (spiritsL > spiritsLimit) patches.push({ label:`Spirituosen auf ${spiritsLimit} L reduzieren`, patch:{ spiritsL: spiritsLimit } });
      if (cigPacks > cigLimitPacks) { const safeCartons = Math.floor(cigLimitPacks/10); patches.push({ label:`Zigaretten auf ${safeCartons} Stangen reduzieren`, patch:{ cigCartons: safeCartons } }); }
      // Fahrzeugwechsel
      const other = vehicles.find(x=>x.id!==v.id);
      if (other) {
        const otherCost = (distanceKm * other.l_per_100km / 100) * fuelDE + (mealInROI?mealCost:0) + fixedCost;
        const delta = (goodsSaving - otherCost) - net;
        if (delta > 2) patches.push({ label:`Fahrzeug wechseln → +${delta.toFixed(2)} €`, patch:{ vehicle: other.id } });
      }
      // Spirits → Bier Switch
      const spiritsDiff = Math.max(0, spiritsDE - spiritsCZ);
      const beerDiff = Math.max(0, beerDE - beerCZ);
      if (spiritsL>0 && beerDiff>spiritsDiff) {
        const switchL = Math.min(spiritsL, Math.max(0, beerLimit - beerL));
        if (switchL>=0.7) patches.push({ label:`${switchL.toFixed(1)} L Spirits → Bier tauschen`, patch:{ spiritsL: +(spiritsL-switchL).toFixed(1), beerL: +(beerL+switchL).toFixed(1) } });
      }
      const best = patches[0];
      if (best){ document.getElementById('nextAction').textContent = best.label; document.getElementById('applyPatch').disabled=false; currentPatch = best.patch; }
      else { document.getElementById('nextAction').textContent = 'Keine Änderung nötig.'; document.getElementById('applyPatch').disabled=true; }

      // KI-Erklärung (Stub) – kurz & eindeutig
      explainWithAI({
        status: ampelClass==='good'?'good':(ampelClass==='warn'?'warn':'bad'),
        net, perHour: netPerHour,
        action: best && best.label || null,
        warn: findings[0] && findings[0].message || null
      }).then(text=>{
        // wir hängen sie unter die Headline
        setText('#headline', text);
      });

      // Breakdown (Expertenmodus)
      const rows = [];
      rows.push(row('Distanz', distanceKm.toFixed(0)+' km'));
      rows.push(row('Zeit', travelTimeH.toFixed(2)+' h'));
      rows.push(row('Fahrzeug', v.name));
      rows.push(row('Reisefuel (L)', travelFuelL.toFixed(2)));
      rows.push(row('Reisefuel‑Kosten', money(travelFuelCost)));
      rows.push(row('Fixkosten', money(fixedCost + (mealInROI?mealCost:0))));
      rows.push(row('—'));
      rows.push(row('Tanksparen', money(fuelSaving)));
      rows.push(row('Biersparen', money(beerSaving)));
      rows.push(row('Spirituosensparen', money(spiritsSaving)));
      rows.push(row('Zigarettensparen', money(cigSaving)));
      rows.push(row('LE‑Sparen', money(foodSaving)));
      rows.push(row('Gesamtersparnis', money(goodsSaving)));
      rows.push(row('—'));
      rows.push(row('NETTO', money(net)));
      document.getElementById('breakdown').innerHTML = rows.join('');

    }catch(e){
      EFA.err('COMPUTE-FAIL-422','Berechnung fehlgeschlagen', String(e), 'S2', {}, ['Eingaben prüfen','Nochmal berechnen']);
      setChip('chip-compute','err');
    }
  }

  function applyPatch(patch){
    if(!patch) return;
    if (patch.reserveL!==undefined) document.getElementById('reserveL').value = patch.reserveL;
    if (patch.spiritsL!==undefined) document.getElementById('spiritsL').value = patch.spiritsL;
    if (patch.cigCartons!==undefined) document.getElementById('cigCartons').value = patch.cigCartons;
    if (patch.beerL!==undefined) document.getElementById('beerL').value = patch.beerL;
    if (patch.vehicle!==undefined) document.getElementById('vehicle').value = patch.vehicle;
    computeAll();
  }

  function row(k,v){ if(k==='—') return `<tr><td colspan="2" style="border-bottom:none;height:8px"></td></tr>`; return `<tr><th>${escapeHtml(k)}</th><td>${escapeHtml(v)}</td></tr>`; }
  function money(x){ return `${x>=0?'+':''}${Number(x).toFixed(2)} €`; }

  // Robustheit: einfache P80‑Simulation (±10% Preis), N=200
  function simulateP80(){
    const N=200; let samples=[];
    const orig = snapshotInputs();
    for(let i=0;i<N;i++){
      jitterPrices(0.10);
      const net = simulateOnce();
      samples.push(net);
    }
    restoreInputs(orig);
    samples.sort((a,b)=>a-b);
    const p80 = samples[Math.floor(0.2*samples.length)];
    setText('#robust', `±10% Preise → P80: ${p80.toFixed(2)} €`);
  }
  function snapshotInputs(){
    const ids=['fuelDE','fuelCZ','beerCZ','beerDE','spiritsCZ','spiritsDE','cigCZ','cigDE'];
    const m={}; ids.forEach(id=>m[id]=document.getElementById(id).value); return m;
  }
  function restoreInputs(m){ Object.keys(m).forEach(id=>document.getElementById(id).value=m[id]); computeAll(); }
  function jitterPrices(rate){
    const ids=['fuelDE','fuelCZ','beerCZ','beerDE','spiritsCZ','spiritsDE','cigCZ','cigDE'];
    ids.forEach(id=>{
      const el=document.getElementById(id); let v=parseFloat(el.value)||0; const r=(Math.random()*2-1)*rate; v=v*(1+r); el.value=v.toFixed(2);
    });
  }
  function simulateOnce(){
    const v = getVehicle();
    const distanceKm = Math.max(1, readNumber('#distanceKm'));
    const fuelDE = readNumber('#fuelDE');
    const fixedCost = Math.max(0, readNumber('#fixedCost')) + (document.getElementById('mealROI').value==='yes'? Math.max(0, readNumber('#mealCost')):0);
    const travelFuelL = distanceKm * v.l_per_100km / 100;
    const travelFuelCost = travelFuelL * fuelDE;

    const fuelTopUpL = Math.max(0, readNumber('#fuelTopUpL'));
    const reserveL = Math.max(0, readNumber('#reserveL'));
    const beerL = Math.max(0, readNumber('#beerL'));
    const spiritsL = Math.max(0, readNumber('#spiritsL'));
    const cigCartons = Math.max(0, Math.floor(readNumber('#cigCartons')));
    const beerCZ = readNumber('#beerCZ'), beerDE = readNumber('#beerDE');
    const spiritsCZ = readNumber('#spiritsCZ'), spiritsDE = readNumber('#spiritsDE');
    const cigCZ = readNumber('#cigCZ'), cigDE = readNumber('#cigDE');
    const foodCZsum = Math.max(0, readNumber('#foodCZsum'));
    const foodDEsum = Math.max(0, readNumber('#foodDEsum'));

    const fuelSaving = (fuelTopUpL + reserveL) * Math.max(0, fuelDE - beerCZ + (beerCZ - beerCZ)); // keep fuelDE-fuelCZ, typo fix next line
    const fuelSav = (fuelTopUpL + reserveL) * Math.max(0, fuelDE - readNumber('#fuelCZ'));
    const beerSaving = beerL * Math.max(0, beerDE - beerCZ);
    const spiritsSaving = spiritsL * Math.max(0, spiritsDE - spiritsCZ);
    const cigPacks = cigCartons * 10;
    const cigSaving = cigPacks * Math.max(0, cigDE - cigCZ);
    const foodSaving = Math.max(0, foodDEsum - foodCZsum);

    const goodsSaving = fuelSav + beerSaving + spiritsSaving + cigSaving + foodSaving;
    return goodsSaving - (travelFuelCost + fixedCost);
  }

})();