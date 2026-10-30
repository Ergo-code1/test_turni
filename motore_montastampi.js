/* Motore Montastampi (pianificazione automatica, regole, validazione).
   Estratto da Pianificazione_turni.html senza modifiche alla logica: interfaccia, rete e finestre sono
   neutralizzate. Caricato dall'app Turni-Ferie solo quando si apre la scheda Montastampi o Regole.
   Non contiene i dati dei turni: arrivano dall'app (Firebase). */
(function(){
'use strict';
const __fake = (() => {
  const cl = {add(){},remove(){},toggle(){return false},contains(){return false}};
  const h = {
    get(t, k){
      if(k === Symbol.toPrimitive) return () => '';
      if(k === 'classList') return cl;
      if(k === 'style' || k === 'dataset') return {};
      if(k === 'options' || k === 'children' || k === 'childNodes') return [];
      if(k === 'value' || k === 'textContent' || k === 'innerHTML' || k === 'title') return '';
      if(k === 'checked' || k === 'disabled' || k === 'open') return false;
      if(k === 'scrollLeft' || k === 'scrollTop' || k === 'offsetWidth' || k === 'clientWidth') return 0;
      if(k === 'then') return undefined;
      return p;
    },
    set(){ return true; },
    apply(){ return p; }
  };
  const p = new Proxy(function(){}, h);
  return p;
})();
const document = {getElementById: () => __fake, querySelector: () => __fake, querySelectorAll: () => [],
  createElement: () => __fake, addEventListener(){}, removeEventListener(){}, body: __fake, documentElement: __fake, title: ''};
const window = {addEventListener(){}, removeEventListener(){}, innerWidth: 1400, close(){}, print(){}};
const localStorage = {getItem(){return null}, setItem(){}, removeItem(){}};
const fetch = () => Promise.reject(new Error('rete non usata dal motore'));
const XMLHttpRequest = function(){ throw new Error('rete non usata dal motore'); };
const setInterval = () => 0;
const alert = () => {};
const confirm = () => false;
const prompt = () => null;
const requestAnimationFrame = f => { try{ f(); }catch(e){} return 0; };

  const STORAGE_KEY = 'pianificazione-turni-v1';
  const MONTHS = [
    'Gennaio','Febbraio','Marzo','Aprile','Maggio','Giugno',
    'Luglio','Agosto','Settembre','Ottobre','Novembre','Dicembre'
  ];
  const DAY_NAMES = ['Dom','Lun','Mar','Mer','Gio','Ven','Sab'];
  // Codici selezionabili in una cella. MUTUA è stato eliminato perché indica
  // la stessa condizione di MALATTIA; C.MAT, PSOCC, CS 8-12 e G Corso non
  // sono più inseribili.
  const SHIFT_OPTIONS = ['', 'M', 'P', 'N', 'GG', 'FERIE', 'MALATTIA', 'RIPOSO', 'CORSO', 'AG', 'AP', 'CS'];
  // Codici ritirati dall'inserimento ma ancora presenti nello storico
  // importato dall'Excel (2025-11..2026-08). Restano visibili nella loro
  // cella e non vengono mai riscritti: lo storico non viene migrato.
  const LEGACY_SHIFT_CODES = ['C.MAT', 'MUTUA', 'PSOCC', 'CS 8-12', 'G Corso'];
  const WORK_SHIFTS = ['M','P','N','GG'];
  // Stati non di turno: non contribuiscono mai alla copertura giornaliera.
  const NON_SHIFT_STATUSES = ['FERIE','MALATTIA','RIPOSO','CORSO','AG','AP','CS', ...LEGACY_SHIFT_CODES];
  // Regola 3: i giorni pagati contano nel totale mensile come i turni.
  // FERIE è esplicitamente "un gg lavorativo"; corso e malattia sono
  // "sempre gg pagati".
  const PAID_NON_SHIFT_STATUSES = ['FERIE','MALATTIA','CORSO'];
  // All written rules apply to schedules from August 2026 onward.
  const RULES_EFFECTIVE_FROM = '2026-08-01';
  // The automatic planner must never alter the imported August plan or any
  // earlier month. Manual editing has its own rolling monthly lock.
  const AUTO_PLANNING_EFFECTIVE_FROM = '2026-09-01';
  // From September 2026 the editable rule set is global: it applies to that
  // month and every following month. Older imported months retain their
  // historical per-month values and are never changed by this setting.
  const GLOBAL_RULES_EFFECTIVE_FROM = '2026-09-01';
  // Punti 8, 9 e 10 di Pianificazione3.xlsx, scheda "regola globale"
  // (verificato 2026-08-06: l'etichetta storica "Regola 6 e regola 7" non
  // corrispondeva ai punti reali). Di norma non si superano 5 giorni
  // consecutivi nello stesso turno (punto 8: minimo 4, di regola 5). Il 6°
  // giorno è ammesso quando la giornata non raggiunge i numeri minimi (punto
  // 9). Il 7° è sempre vietato (punto 10: "operatore non può lavorare 7
  // giorni consecutivi").
  const MAX_CONSECUTIVE_WORK_DAYS = 5;
  const MAX_CONSECUTIVE_WORK_DAYS_SHORTAGE = 6;
  const MAX_SAME_SHIFT_DAYS = 6;
  // Regola inderogabile valida per TUTTE le persone (richiesta PM 2026-08-07):
  // dopo 5 giorni consecutivi di GG serve 1 giorno di riposo. Un blocco di GG
  // non può quindi superare 5 giorni e il giorno che lo segue non può essere
  // un turno di lavoro. Non ammette deroghe per carenza di copertura.
  const MAX_CONSECUTIVE_GG_DAYS = 5;
  // DEGRANDI ROBERTO - UNICA regola individuale ammessa per questa persona
  // (richiesta PM 2026-08-07). È una regola FISSA e INDEROGABILE: non è
  // modificabile dal pannello "Gestione regole", non ammette deroghe per
  // carenza di copertura e sostituisce integralmente ogni definizione
  // speciale precedente (blocco minimo di GG, M feriale in carenza, ecc.),
  // che è stata rimossa. Il pannello la mostra in sola lettura.
  const DEGRANDI_MAX_SATURDAY_M = 2;
  const DEGRANDI_MAX_CONSECUTIVE_WORK_DAYS = 5;
  const DEGRANDI_RULE_TEXT = Object.freeze([
    'Dal lunedì al venerdì lavora soltanto in GG: nessun altro turno gli viene assegnato.',
    'La M è ammessa soltanto il sabato; la domenica non lavora mai.',
    `Al massimo ${DEGRANDI_MAX_SATURDAY_M} sabati in M per mese.`,
    `Dopo ${DEGRANDI_MAX_CONSECUTIVE_WORK_DAYS} giorni di lavoro consecutivi deve avere 1 giorno di riposo, collocabile in qualunque momento della settimana.`
  ]);
  // Parametri regolabili dal pannello "Gestione regole". Da settembre 2026
  // risiedono in state.globalRules e valgono per tutti i mesi successivi;
  // state.monthRules conserva esclusivamente i valori storici precedenti.
  // Origine dei default: copertura minima giornaliera (feriale M3/P3/N2,
  // weekend e festivi M2/P2/N1, come la vecchia targetsFor); punto 8 di
  // "regola globale" per i giorni consecutivi nello stesso turno (il default
  // passa da 4 a 3 su richiesta PM 2026-08-07); massimo persone in ferie
  // nella stessa settimana; punto 11 di "regola globale" per i giorni di
  // riposo dopo un blocco che si chiude con la notte; giorni di lavoro
  // mensili rinunciabili (il totale ammesso diventa da limite-rinunciabili a
  // limite, con 0 = tutti esattamente al limite).
  // Numero di combinazioni deterministiche di ciascun pulsante di
  // pianificazione (richiesta PM 2026-08-07). Ogni pressione usa la
  // combinazione successiva e la mostra come "Combinazione n/N"; dopo l'ultima
  // si ricomincia dalla prima. La combinazione 1 è il comportamento storico.
  const PLAN_VARIANT_COUNT = 5;
  const IMPROVE_PLAN_BTN_TITLE = 'Ripianifica con la seconda serie di minimi (scheda Gestione regole) mettendo in deroga solo il blocco settimanale minimo dello stesso turno';
  const RULE_DEFAULTS = Object.freeze({
    covWeekdayM:3, covWeekdayP:3, covWeekdayN:2,
    covWeekendM:2, covWeekendP:2, covWeekendN:1,
    // Seconda serie di minimi, usata SOLTANTO dal pulsante "Migliora
    // pianificazione" (richiesta PM 2026-08-07). È mensile e indipendente
    // esattamente come la prima: un mese non eredita mai l'altro. Può essere
    // alzata o abbassata rispetto alla serie di default senza toccarla.
    impCovWeekdayM:3, impCovWeekdayP:3, impCovWeekdayN:2,
    impCovWeekendM:2, impCovWeekendP:2, impCovWeekendN:1,
    // Punto 17 di "regola globale": numeri MASSIMI per turno, accanto ai
    // minimi. 31 = nessun limite (comportamento storico invariato).
    maxWeekdayM:31, maxWeekdayP:31, maxWeekdayN:31,
    maxWeekendM:31, maxWeekendP:31, maxWeekendN:31,
    // Punto 15: di norma 2 weekend lavorati per persona al mese (preferenza
    // dell'automatico). Il divieto di lavorarli TUTTI e' hard e fisso.
    maxWeekendsPerPerson:2,
    minSameShiftDays:3,
    maxWeeklyFeriePeople:3,
    restAfterNights:2,
    waivedWorkDays:1
  });
  const RULE_LIMITS = Object.freeze({
    covWeekdayM:[0,31], covWeekdayP:[0,31], covWeekdayN:[0,31],
    covWeekendM:[0,31], covWeekendP:[0,31], covWeekendN:[0,31],
    impCovWeekdayM:[0,31], impCovWeekdayP:[0,31], impCovWeekdayN:[0,31],
    impCovWeekendM:[0,31], impCovWeekendP:[0,31], impCovWeekendN:[0,31],
    maxWeekdayM:[1,31], maxWeekdayP:[1,31], maxWeekdayN:[1,31],
    maxWeekendM:[1,31], maxWeekendP:[1,31], maxWeekendN:[1,31],
    maxWeekendsPerPerson:[0,5],
    minSameShiftDays:[1,MAX_SAME_SHIFT_DAYS],
    maxWeeklyFeriePeople:[0,31],
    restAfterNights:[0,7],
    waivedWorkDays:[0,10]
  });
  function normalizeMonthRules(raw){
    const source = raw && typeof raw === 'object' ? raw : {};
    const out = {};
    Object.keys(RULE_DEFAULTS).forEach(name => {
      const [min,max] = RULE_LIMITS[name];
      const value = Number(source[name]);
      out[name] = Number.isFinite(value) ? Math.min(max,Math.max(min,Math.round(value))) : RULE_DEFAULTS[name];
    });
    // Un massimo non puo' stare sotto nessuno dei due minimi dello stesso turno.
    ['M','P','N'].forEach(code => {
      out[`maxWeekday${code}`] = Math.max(out[`maxWeekday${code}`],out[`covWeekday${code}`],out[`impCovWeekday${code}`]);
      out[`maxWeekend${code}`] = Math.max(out[`maxWeekend${code}`],out[`covWeekend${code}`],out[`impCovWeekend${code}`]);
    });
    return out;
  }
  // La validazione rilegge i parametri per ogni persona e per ogni giorno:
  // senza cache normalizeMonthRules girerebbe decine di migliaia di volte per
  // ogni validateSchedule. La cache va svuotata a ogni cambio di stato che
  // possa toccare monthRules (salvataggio pannello, import, undo/redo).
  const monthRulesCache = new Map();
  function invalidateMonthRulesCache(){
    monthRulesCache.clear();
  }
  function rulesForMonth(key){
    if(monthRulesCache.has(key)) return monthRulesCache.get(key);
    const date = `${key}-01`;
    const source = date >= GLOBAL_RULES_EFFECTIVE_FROM
      ? state?.globalRules
      : state?.monthRules?.[key];
    const value = Object.freeze(normalizeMonthRules(source));
    monthRulesCache.set(key,value);
    return value;
  }
  // Tutta la pianificazione e tutta la validazione lavorano sul mese attivo,
  // quindi una settimana a cavallo di due mesi usa i parametri del mese che
  // il PM sta guardando.
  function activeRules(){
    return rulesForMonth(monthKey(activeYear,activeMonth));
  }
  // Punto 6 di "regola globale": rotazione per persona mattina -> riposo ->
  // notte -> riposo -> pomeriggio -> riposo -> mattina; finora non erano
  // implementati né la rotazione né il vincolo di un giorno di riposo fra
  // blocchi diversi (bug segnalato dalla PM 2026-08-06). GG non è un turno
  // (punto 4) e resta fuori dalla rotazione.
  const SHIFT_ROTATION_ORDER = ['M','N','P'];
  function nextRotationShift(shift){
    const index = SHIFT_ROTATION_ORDER.indexOf(shift);
    return index === -1 ? '' : SHIFT_ROTATION_ORDER[(index+1) % SHIFT_ROTATION_ORDER.length];
  }
  // Se il turno successivo della rotazione è uno che la persona non ha
  // selezionato (can.X === false), si salta a quello dopo, ciclando al
  // massimo una volta sull'intero ordine (richiesta PM 2026-08-06: "se non
  // lo fa, salta quel turno e riparte dal prossimo, non deve saltare tutte
  // le date successive").
  function nextAllowedRotationShift(person,shift){
    let candidate = shift;
    for(let i=0;i<SHIFT_ROTATION_ORDER.length;i += 1){
      candidate = nextRotationShift(candidate);
      if(!candidate) return candidate;
      if(person.can[candidate] !== false) return candidate;
    }
    return '';
  }
  const AUTO_SHIFT_CODES = ['M','P','N','GG'];
  const LEVELS = ['ALTO','MEDIO','BASSO'];
  const UNDO_LIMIT = 50;

  const initialStaff = [
    {id:'pionzio-andrea', name:'PIONZIO ANDREA'},
    {id:'degrandi-roberto', name:'DEGRANDI ROBERTO'},
    {id:'cipolla-eugenio', name:'CIPOLLA EUGENIO', level:'ALTO'},
    {id:'cominelli-rosalino', name:'COMINELLI ROSALINO'},
    {id:'volpe-leonard', name:'VOLPE LEONARD'},
    {id:'fera-giuseppe', name:'FERA GIUSEPPE'},
    {id:'peretto-enrico', name:'PERETTO ENRICO'},
    {id:'grassis-marco', name:'GRASSIS MARCO', level:'ALTO'},
    {id:'gastaldo-brac-paolo', name:'GASTALDO BRAC PAOLO'},
    {id:'andrea-paonessa', name:'ANDREA PAONESSA'},
    {id:'gregorio-cignetti', name:'GREGORIO CIGNETTI'},
    {id:'silvio-morello', name:'SILVIO MORELLO'},
    {id:'meneghin-marco', name:'MENEGHIN MARCO'},
    {id:'peretto-loris', name:'PERETTO LORIS'},
    {id:'grosso-aldo', name:'GROSSO ALDO'},
    {id:'luigi-zaccagnino', name:'LUIGI ZACCAGNINO'},
    {id:'mattia-ambrosia', name:'MATTIA AMBROSIA'},
    {id:'ayub-hifdi', name:'AYUB HIFDI'},
    {id:'giuffria-matteo', name:'GIUFFRIA MATTEO'},
    {id:'hamza-rahhali', name:'HAMZA RAHHALI'},
    {id:'enrico-gianotti', name:'ENRICO GIANOTTI'}
  ].map(p => ({
    id:p.id,
    name:p.name,
    can:Object.assign({M:true,P:true,N:true,GG:true,WKENDFESM:true,WKENDFESP:true,WKENDFESN:true}, p.can || {}),
    level:LEVELS.includes(p.level) ? p.level : 'MEDIO',
    note:''
  }));

  // Regola 12: percentuali storiche individuali per turno, dalla scheda
  // "regola individuali" di Pianificazione3.xlsx (dato nero/confermato,
  // riga C14 regola globale), con weekend e festivo fusi in un'unica
  // categoria per persona (richiesta PM 2026-08-05). M/P/N/GG = quota sui
  // giorni feriali; WKENDFESM/WKENDFESP/WKENDFESN = quota combinata sui
  // giorni di weekend E festivi (somma delle vecchie colonne WKx+Fx; dopo
  // la fusione non è più possibile distinguere separatamente "solo
  // weekend" da "solo festivo"). La colonna G weekend/festivo (WKG+FESTIVG)
  // è stata rimossa dalla scheda Excel perché sostanzialmente nulla per
  // tutte le 13 persone (richiesta PM 2026-08-06): GG resta quindi solo sul
  // dato feriale. Le persone non elencate qui restano sulla vecchia
  // ripartizione uniforme (vedi fallback in monthlyShiftQuota).
  const HISTORICAL_SHIFT_QUOTA_PCT = {
    'pionzio-andrea': {M:.220,P:.340,N:.247,GG:0, WKENDFESM:.080,WKENDFESP:.060,WKENDFESN:.054},
    'degrandi-roberto': {M:.196,P:0,N:0,GG:.689, WKENDFESM:.115,WKENDFESP:0,WKENDFESN:0},
    'cipolla-eugenio': {M:.450,P:.396,N:0,GG:0, WKENDFESM:.081,WKENDFESP:.074,WKENDFESN:0},
    'cominelli-rosalino': {M:0,P:0,N:0,GG:.993, WKENDFESM:.007,WKENDFESP:0,WKENDFESN:0},
    'volpe-leonard': {M:.375,P:.167,N:.236,GG:.049, WKENDFESM:.056,WKENDFESP:.035,WKENDFESN:.083},
    'fera-giuseppe': {M:.273,P:.280,N:.259,GG:0, WKENDFESM:.028,WKENDFESP:.084,WKENDFESN:.077},
    'peretto-enrico': {M:.187,P:.373,N:.273,GG:0, WKENDFESM:.033,WKENDFESP:.047,WKENDFESN:.087},
    'grassis-marco': {M:.474,P:.394,N:0,GG:0, WKENDFESM:.124,WKENDFESP:0,WKENDFESN:0},
    'gastaldo-brac-paolo': {M:.269,P:.327,N:.205,GG:0, WKENDFESM:.051,WKENDFESP:.071,WKENDFESN:.077},
    'andrea-paonessa': {M:.340,P:.314,N:.189,GG:0, WKENDFESM:.070,WKENDFESP:.082,WKENDFESN:.006},
    'gregorio-cignetti': {M:.293,P:.286,N:.238,GG:0, WKENDFESM:.068,WKENDFESP:.054,WKENDFESN:.061},
    'silvio-morello': {M:.149,P:.217,N:.186,GG:.342, WKENDFESM:.050,WKENDFESP:.056,WKENDFESN:0},
    'meneghin-marco': {M:.104,P:.231,N:.209,GG:.343, WKENDFESM:.022,WKENDFESP:.082,WKENDFESN:.007}
  };

  // Regola 12: pattern generico "spunta se >0% in tabella" (richiesta PM
  // 2026-08-05, aggiornata 2026-08-06 per la rimozione della colonna G
  // weekend/festivo e per la separazione weekend/festivo per turno, in modo
  // che il pannello Personale mostri esattamente le stesse 7 colonne della
  // scheda "regola individuali": M/P/N/GG feriale + WKENDFESM/WKENDFESP/
  // WKENDFESN. Per le sole 13 persone con una riga in
  // HISTORICAL_SHIFT_QUOTA_PCT: can.M/P/N derivano dalla presenza di
  // storico >0 su quel turno (feriale O weekend/festivo fuso); can.GG
  // deriva solo dal dato feriale (GG non ha una colonna weekend/festivo);
  // can.WKENDFESM/WKENDFESP/WKENDFESN sono tre spunte indipendenti, una per
  // ciascuna colonna WKENDFESx della tabella (>0%). Le 8 persone senza riga
  // storica non vengono toccate: restano sulle abilitazioni di default.
  // Riallinea le spunte alle percentuali storiche, MA non riaccende mai un
  // turno che il file salvato ha esplicitamente messo a false.
  //
  // Il riallineamento nasce per correggere le spunte vecchie rimaste in un
  // salvataggio anteriore a HISTORICAL_SHIFT_QUOTA_PCT (richiesta PM
  // 2026-08-06). Applicato in entrambe le direzioni però cancella anche le
  // scelte esplicite della PM: SILVIO MORELLO era stato messo a solo GG nel
  // file, ma le sue percentuali storiche (M 14,9% - P 21,7% - N 18,6%)
  // gli riaccendevano M/P/N ad ogni caricamento, e la pianificazione
  // continuava ad assegnargli turni che la PM aveva escluso (bug segnalato
  // dalla PM 2026-08-07). Il gate di versione non bastava: il file resta a
  // version 8 finché non viene risalvato dal programma, quindi la
  // sovrascrittura si ripeteva ad ogni apertura.
  //
  // Vince quindi sempre il vincolo più restrittivo: lo storico può togliere
  // un turno mai svolto, non può restituirne uno tolto a mano.
  function applyHistoricalCapabilities(people){
    people.forEach(person => {
      const pct = HISTORICAL_SHIFT_QUOTA_PCT[person.id];
      if(!pct) return;
      const saved = person.can || {};
      const fromHistory = {
        M: (pct.M||0) > 0 || (pct.WKENDFESM||0) > 0,
        P: (pct.P||0) > 0 || (pct.WKENDFESP||0) > 0,
        N: (pct.N||0) > 0 || (pct.WKENDFESN||0) > 0,
        GG: (pct.GG||0) > 0,
        WKENDFESM: (pct.WKENDFESM||0) > 0,
        WKENDFESP: (pct.WKENDFESP||0) > 0,
        WKENDFESN: (pct.WKENDFESN||0) > 0
      };
      Object.keys(fromHistory).forEach(code => {
        if(saved[code] === false) fromHistory[code] = false;
      });
      person.can = Object.assign({}, saved, fromHistory);
    });
  }
  applyHistoricalCapabilities(initialStaff);

  // Storico copiato dalla scheda "pianificazione" di Pianificazione.xlsx.
  // Sono inclusi entrambi i gruppi di personale. G, 09-18 e G (SV) sono normalizzati in GG.
  const JUNE_2026_HISTORY = {};

  const COMPANY_CLOSED_DATES = {
    '2026-06-01':'Chiusura aziendale riportata nello storico Excel',
    '2026-06-02':'Festa della Repubblica / chiusura aziendale'
  };

  const today = new Date();
  let state = createEmptyState();
  let sharedFileName = '';
  let sharedDirty = false;
  // Uscita decisa dal pannello di chiusura: il browser non deve più mostrare
  // il proprio avviso "modifiche non salvate", la scelta è già stata fatta.
  let closingIntentionally = false;
  let sharedSaveTimer = null;
  let sharedSaving = false;
  let sharedLoaded = false;
  let activeYear = 2026;
  let activeMonth = 5;
  let selectedDateKey = dateKey(new Date(activeYear, activeMonth, 1));
  let validation = emptyValidation();
  let dragFill = {active:false,startRow:-1,startCol:-1,endRow:-1,endCol:-1,value:'',source:null};
  let undoStack = [];
  let selectedRange = {startRow:0,startCol:0,endRow:0,endCol:0};
  let activeCell = {row:0,col:0};
  let internalClipboard = null;
  // Punto 6: la ridistribuzione delle persone sulle fasi di rotazione avviene
  // una sola volta per esecuzione della pianificazione automatica, nel primo
  // mese. runAutomaticPlanning lo rimette a false prima del ciclo sui mesi.
  let rotationPhaseShuffleDone = false;
  // Acceso solo per la durata di una passata del pulsante "Migliora
  // pianificazione" (richiesta PM 2026-08-07). Mentre è acceso valgono i
  // minimi di copertura della seconda serie mensile e il blocco settimanale
  // minimo va in deroga. Tutto il resto resta invariato, e la validazione
  // mostrata alla PM viene sempre ricalcolata a flag spento.
  let improvePlanRun = false;
  // Combinazione della passata in corso (0 = combinazione 1, comportamento
  // storico senza perturbazione).
  let planVariantIndex = 0;

  // Il minimo di giorni consecutivi nello stesso turno resta inderogabile anche
  // durante "Migliora pianificazione": quella passata modifica solo i minimi
  // di copertura, non può creare blocchi M/P/N/GG di uno o due giorni.
  function effectiveMinSameShiftDays(){
    return activeRules().minSameShiftDays;
  }

  // Perturbazione deterministica legata alla combinazione corrente: stessa
  // combinazione = stesso risultato, combinazioni diverse = scelte diverse fra
  // candidati equivalenti. Massimo < 4, cioè meno del più piccolo scalino
  // reale del punteggio (workRun = 8): non può scavalcare una differenza vera.
  function variantJitter(personId,shift){
    if(!planVariantIndex) return 0;
    const source = `${planVariantIndex}|${personId}|${shift}`;
    let hash = 2166136261;
    for(let i=0;i<source.length;i += 1){
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash,16777619) >>> 0;
    }
    return ((hash >>> 8) % 1000) / 250;
  }

  // Ordine di scorrimento delle persone per la combinazione corrente. Con la
  // combinazione 1 le chiavi sono tutte 0 e il sort stabile lascia l'ordine
  // originale, quindi il risultato storico è identico.
  function staffInVariantOrder(){
    if(!planVariantIndex) return state.staff;
    return state.staff.slice().sort((a,b) => variantJitter(a.id,'ordine') - variantJitter(b.id,'ordine'));
  }

  // Avanza il contatore delle combinazioni del pulsante indicato ('auto' o
  // 'improve') e restituisce quella da usare adesso. I due pulsanti hanno
  // contatori separati; dopo l'ultima si ricomincia dalla prima.
  function takePlanVariant(kind){
    state.planVariants ||= {};
    const current = Number(state.planVariants[kind]) || 0;
    state.planVariants[kind] = (current + 1) % PLAN_VARIANT_COUNT;
    return current % PLAN_VARIANT_COUNT;
  }

  const els = {
    yearSelect:document.getElementById('yearSelect'),
    autoPlanBtn:document.getElementById('autoPlanBtn'),
    improvePlanBtn:document.getElementById('improvePlanBtn'),
    monthSelect:document.getElementById('monthSelect'),
    monthTitle:document.getElementById('monthTitle'),
    monthSubtitle:document.getElementById('monthSubtitle'),
    staffBody:document.getElementById('staffBody'),
    scheduleTable:document.getElementById('scheduleTable'),
    selectedDateLabel:document.getElementById('selectedDateLabel'),
    selectedHolidayName:document.getElementById('selectedHolidayName'),
    selectedTypeBadge:document.getElementById('selectedTypeBadge'),
    shiftNames:document.getElementById('shiftNames'),
    issues:document.getElementById('issues'),
    monthIssues:document.getElementById('monthIssues'),
    monthConflictCount:document.getElementById('monthConflictCount'),
    conflictBanner:document.getElementById('conflictBanner'),
    monthlyTotals:document.getElementById('monthlyTotals'),
    continuityInfo:document.getElementById('continuityInfo'),
    autoPlanStatus:document.getElementById('autoPlanStatus'),
    saveStatus:document.getElementById('saveStatus'),
    absenceModal:document.getElementById('absenceModal'),
    exitModal:document.getElementById('exitModal'),
    exitNote:document.getElementById('exitNote'),
    rulesModal:document.getElementById('rulesModal'),
    rulesTitle:document.getElementById('rulesTitle'),
    rulesGlobalTab:document.getElementById('rulesGlobalTab'),
    rulesIndividualTab:document.getElementById('rulesIndividualTab'),
    rulesGlobalPanel:document.getElementById('rulesGlobalPanel'),
    rulesIndividualPanel:document.getElementById('rulesIndividualPanel'),
    rulesScopeNote:document.getElementById('rulesScopeNote'),
    monthlyWorkingDayTarget:document.getElementById('monthlyWorkingDayTarget'),
    monthlyWorkingDayStandard:document.getElementById('monthlyWorkingDayStandard'),
    rulesWaivedNote:document.getElementById('rulesWaivedNote'),
    rulesDegrandiNote:document.getElementById('rulesDegrandiNote'),
    applyRulesBtn:document.getElementById('applyRulesBtn'),
    resetRulesBtn:document.getElementById('resetRulesBtn'),
    absenceStaff:document.getElementById('absenceStaff'),
    absenceType:document.getElementById('absenceType'),
    absenceStart:document.getElementById('absenceStart'),
    absenceEnd:document.getElementById('absenceEnd'),
    absenceNote:document.getElementById('absenceNote'),
    absenceList:document.getElementById('absenceList'),
    saveSharedBtn:document.getElementById('saveSharedBtn'),
    layout:document.querySelector('.layout'),
    leftResizer:document.getElementById('leftResizer'),
    rightResizer:document.getElementById('rightResizer')
  };

  function normalizeLevel(value){
    const level = String(value || '').toUpperCase();
    return LEVELS.includes(level) ? level : 'MEDIO';
  }

  function migrateState(parsed){
    const previousVersion = parsed.version || 0;
    parsed.schedules ||= {};
    parsed.absences ||= [];
    parsed.customHolidays ||= [];
    parsed.manualCells ||= {};
    parsed.shiftLeaders ||= {};
    parsed.historySeeds ||= {};
    parsed.deletedStaffIds ||= [];
    parsed.pendingReplanFrom ||= null;
    parsed.monthlyWorkingDayOverrides ||= {};
    parsed.monthlyWorkingDayOverrides = Object.fromEntries(
      Object.entries(parsed.monthlyWorkingDayOverrides).filter(([key,value]) =>
        /^\d{4}-\d{2}$/.test(key) && Number.isInteger(Number(value)) && Number(value) >= 1 && Number(value) <= 31
      ).map(([key,value]) => [key,Number(value)])
    );
    // Le regole mensili restano soltanto come storico. Al primo caricamento
    // della nuova struttura, settembre diventa la sorgente delle regole
    // globali; se manca, si usano i default normalizzati.
    parsed.monthRules ||= {};
    // Contatore delle combinazioni, uno per pulsante. Serve solo a far
    // avanzare la combinazione a ogni pressione, non fa parte dei dati turni.
    parsed.planVariants ||= {};
    Object.keys(parsed.monthRules).forEach(key => {
      parsed.monthRules[key] = normalizeMonthRules(parsed.monthRules[key]);
    });
    parsed.globalRules = normalizeMonthRules(
      parsed.globalRules || parsed.monthRules[GLOBAL_RULES_EFFECTIVE_FROM.slice(0,7)] || RULE_DEFAULTS
    );
    invalidateMonthRulesCache();
    parsed.ui ||= {};
    parsed.ui.leftWidth = Number.isFinite(Number(parsed.ui.leftWidth)) ? Number(parsed.ui.leftWidth) : 280;
    parsed.ui.rightWidth = Number.isFinite(Number(parsed.ui.rightWidth)) ? Number(parsed.ui.rightWidth) : 285;
    const existingStaff = new Map((parsed.staff || []).map(p => [p.id,p]));
    const standardIds = new Set(initialStaff.map(p => p.id));
    const deletedStaffIds = new Set(parsed.deletedStaffIds || []);
    const mergedStandard = initialStaff.filter(defaultPerson => !deletedStaffIds.has(defaultPerson.id)).map(defaultPerson => {
      const saved = existingStaff.get(defaultPerson.id) || {};
      const defaultHigh = ['cipolla-eugenio','grassis-marco'].includes(defaultPerson.id);
      const migratedLevel = saved.level ? normalizeLevel(saved.level) : (defaultHigh ? 'ALTO' : normalizeLevel(defaultPerson.level));
      return {
        ...defaultPerson,
        ...saved,
        name:saved.name || defaultPerson.name,
        level:migratedLevel,
        can:Object.assign({M:true,P:true,N:true,GG:true,WKENDFESM:true,WKENDFESP:true,WKENDFESN:true}, defaultPerson.can || {}, saved.can || {})
      };
    });
    const customPeople = (parsed.staff || []).filter(p => !standardIds.has(p.id)).map(p => ({
      ...p,
      level:normalizeLevel(p.level),
      can:Object.assign({M:true,P:true,N:true,GG:true,WKENDFESM:true,WKENDFESP:true,WKENDFESN:true}, p.can || {})
    }));
    parsed.staff = [...mergedStandard,...customPeople];

    // Previous versions could not distinguish manual and automatic values.
    // To avoid changing existing user data, all pre-v4 populated cells are treated as manual.
    if(previousVersion < 4){
      Object.values(parsed.schedules).forEach(month => {
        Object.entries(month || {}).forEach(([dKey, day]) => {
          Object.entries(day || {}).forEach(([staffId, value]) => {
            if(value) parsed.manualCells[`${staffId}|${dKey}`] = value;
          });
        });
      });
    }
    // saved.can (righe 1249/1255 sopra) sovrascrive sempre defaultPerson.can,
    // quindi un file già salvato prima che HISTORICAL_SHIFT_QUOTA_PCT
    // esistesse (o prima di una sua modifica) mostra nel pannello Personale
    // le vecchie spunte per sempre, anche dopo che il codice è stato
    // aggiornato — bug segnalato dalla PM 2026-08-06. Un solo riallineamento
    // forzato al caricamento (gate di versione, non ad ogni salvataggio)
    // riporta le 13 persone storiche sulle spunte correnti derivate da
    // HISTORICAL_SHIFT_QUOTA_PCT; le spunte manuali successive a questo
    // riallineamento restano persistenti come prima. Versione 10: can.WKEND/
    // can.FEST (generici) sono stati sostituiti da can.WKENDFESM/P/N (per
    // turno), per riflettere nel pannello Personale le stesse 7 colonne
    // della scheda Excel; i vecchi campi WKEND/FEST restano nel salvataggio
    // come dato morto (non più letto da nessuna funzione) finché non viene
    // sovrascritto da un nuovo salvataggio.
    if(previousVersion < 10){
      applyHistoricalCapabilities(parsed.staff);
    }
    parsed.version = 12;
    return parsed;
  }

  function createEmptyState(){
    return migrateState({
      version:8,
      staff:initialStaff,
      schedules:{},
      absences:[],
      customHolidays:[],
      manualCells:{},
      shiftLeaders:{},
      globalRules:RULE_DEFAULTS,
      monthlyWorkingDayOverrides:{},
      historySeeds:{},
      deletedStaffIds:[],
      pendingReplanFrom:null
    });
  }

  function countLoadedCells(){
    return Object.values(state.schedules || {}).reduce(
      (total, monthData) => total + Object.values(monthData || {}).reduce(
        (monthTotal, dayData) => monthTotal + Object.values(dayData || {}).filter(Boolean).length,
        0
      ),
      0
    );
  }

  function showCurrentMonth(){
    const current = systemTodayStart();
    activeYear = current.getFullYear();
    activeMonth = current.getMonth();
    selectedDateKey = dateKey(current);
    return monthKey(activeYear,activeMonth);
  }

  async function readSharedFile(){
    try{
      const response = await fetch('/api/data', {cache:'no-store'});
      if(!response.ok) throw new Error(await response.text() || `HTTP ${response.status}`);
      const payload = await response.json();
      const parsed = payload?.data;
      if(!parsed || !Array.isArray(parsed.staff) || typeof parsed.schedules !== 'object'){
        throw new Error('Formato dati non valido');
      }

      state = migrateState(parsed);
      sharedFileName = payload.fileName || 'file JSON';
      sharedLoaded = true;
      sharedDirty = false;
      const currentMonth = showCurrentMonth();
      populateSelectors();
      renderAll();
      updateSaveStatus(false);
      setAutoPlanStatus(`Dati caricati: ${countLoadedCells()} turni · visualizzato ${currentMonth}.`);
      els.autoPlanBtn.disabled = isHistoricalMonth(activeYear,activeMonth);
      els.improvePlanBtn.disabled = els.autoPlanBtn.disabled;
      els.saveSharedBtn.disabled = false;
      return true;
    }catch(err){
      console.error('Caricamento dati non riuscito', err);
      sharedLoaded = false;
      els.autoPlanBtn.disabled = true;
      els.improvePlanBtn.disabled = true;
      els.saveSharedBtn.disabled = true;
      updateSaveStatus(true, 'Errore: avviare la pagina tramite Avvia_pianificazione.bat');
      setAutoPlanStatus('Dati non caricati: la pianificazione automatica è disabilitata.', true);
      return false;
    }
  }

  function postJsonWithXhr(url, body){
    return new Promise((resolve,reject)=>{
      const xhr = new XMLHttpRequest();
      xhr.open('POST',url,true);
      xhr.setRequestHeader('Content-Type','application/json; charset=utf-8');
      xhr.timeout = 15000;
      xhr.onreadystatechange = ()=>{
        if(xhr.readyState !== 4) return;
        if(xhr.status >= 200 && xhr.status < 300){
          try{ resolve(JSON.parse(xhr.responseText)); }
          catch(err){ reject(new Error(`Risposta non valida: ${xhr.responseText || err.message}`)); }
        }else{
          reject(new Error(xhr.responseText || `HTTP ${xhr.status}`));
        }
      };
      xhr.onerror = ()=>reject(new Error('Connessione al programma di avvio non riuscita.'));
      xhr.ontimeout = ()=>reject(new Error('Tempo di salvataggio scaduto.'));
      xhr.send(body);
    });
  }

  async function writeSharedFile(showAlert=false){
    if(!sharedLoaded){
      alert('I dati non sono stati caricati dal programma di avvio.');
      return false;
    }
    if(sharedSaving){
      alert('Salvataggio già in corso.');
      return false;
    }
    sharedSaving = true;
    const originalButtonText = els.saveSharedBtn.textContent;
    els.saveSharedBtn.disabled = true;
    els.saveSharedBtn.textContent = 'Salvataggio V11…';
    setAutoPlanStatus(`Invio dati a ${sharedFileName}…`);
    try{
      state.version = 8;
      state.savedAt = new Date().toISOString();
      const body = JSON.stringify(state,null,2);
      const result = await postJsonWithXhr('/api/data',body);
      sharedFileName = result.fileName || sharedFileName;
      sharedDirty = false;
      updateSaveStatus(false);
      setAutoPlanStatus(`SALVATAGGIO OK: ${result.fullPath || sharedFileName} · ${result.modifiedAt || ''}. La pagina resta aperta.`);
      return true;
    }catch(err){
      const detail = err?.message || String(err);
      console.error('Salvataggio V11 non riuscito',err);
      updateSaveStatus(true,`Salvataggio non riuscito: ${detail}`);
      setAutoPlanStatus(`Salvataggio non riuscito: ${detail}`,true);
      alert(`SALVATAGGIO NON RIUSCITO\n\n${detail}`);
      return false;
    }finally{
      sharedSaving = false;
      els.saveSharedBtn.disabled = !sharedLoaded;
      els.saveSharedBtn.textContent = originalButtonText;
    }
  }

  window.salvaDatiV11 = function(event){
    if(event){ event.preventDefault(); event.stopPropagation(); }
    writeSharedFile(true);
    return false;
  };

  // Chiusura dell'applicazione: il server spegne se stesso e chiude la finestra
  // Edge dedicata, quindi non restano processi né dati vecchi in memoria.
  async function shutdownApplication(){
    closingIntentionally = true;
    setAutoPlanStatus('Chiusura del programma in corso…');
    try{
      await postJsonWithXhr('/api/close','{}');
    }catch(err){
      // Il server chiude comunque appena la finestra sparisce: un errore qui
      // non deve impedire l'uscita.
      console.warn('Richiesta di chiusura non confermata dal server',err);
    }
    try{ window.close(); }catch(err){}
  }

  // Richiesta PM 2026-08-07: uscendo senza aver salvato bisogna chiedere se
  // salvare. Il pulsante "Chiudi" è l'unico punto in cui il browser permette
  // di offrire le tre scelte; premendo la X della finestra resta l'avviso
  // standard di Edge, che non è personalizzabile.
  function requestApplicationExit(){
    if(!sharedDirty){
      shutdownApplication();
      return;
    }
    els.exitNote.innerHTML = `Ci sono modifiche non ancora scritte in <strong>${sharedFileName}</strong>. Salvarle prima di chiudere il programma?`;
    els.exitModal.classList.add('open');
  }

  function closeExitModal(){
    els.exitModal.classList.remove('open');
  }

  async function exitSavingFirst(){
    closeExitModal();
    const saved = await writeSharedFile();
    // Se il salvataggio fallisce l'errore è già a video: non si esce, altrimenti
    // la chiusura butterebbe via proprio i dati che si voleva conservare.
    if(!saved) return;
    shutdownApplication();
  }

  function exitWithoutSaving(){
    closeExitModal();
    shutdownApplication();
  }

  function saveState(){
    sharedDirty = true;
    updateSaveStatus(false);
  }

  function updateSaveStatus(hasError=false,message=''){
    if(!els.saveStatus) return;
    if(hasError){
      els.saveStatus.textContent = message || 'Errore dati condivisi';
      return;
    }
    if(!sharedLoaded){
      els.saveStatus.textContent = 'Avvio dati in corso…';
      return;
    }
    if(sharedDirty){
      els.saveStatus.textContent = `Modifiche non salvate · ${sharedFileName}`;
      return;
    }
    if(!state.savedAt){
      els.saveStatus.textContent = `Dati caricati da ${sharedFileName}`;
      return;
    }
    const saved = new Date(state.savedAt);
    els.saveStatus.textContent = `Salvato in ${sharedFileName} alle ${saved.toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit',second:'2-digit'})}`;
  }

  async function autoLoadSharedFile(){
    return readSharedFile();
  }

  // Gate password (richiesto 2026-08-12): al primo avvio si imposta la password,
  // ai successivi la si inserisce per entrare. I dati condivisi vengono caricati
  // solo dopo l'accesso. Se il server di autenticazione non risponde, non si
  // blocca l'uso del programma.
  async function startAuthGate(){
    const overlay = document.getElementById('authGate');
    const title = document.getElementById('authGateTitle');
    const hint = document.getElementById('authGateHint');
    const pass1 = document.getElementById('authGatePass1');
    const pass2 = document.getElementById('authGatePass2');
    const pass2Row = document.getElementById('authGatePass2Row');
    const errBox = document.getElementById('authGateError');
    const btn = document.getElementById('authGateBtn');

    function showErr(msg){ errBox.textContent = msg || ''; errBox.style.display = msg ? 'block' : 'none'; }
    function enter(){ overlay.style.display = 'none'; autoLoadSharedFile(); }

    let configured = false;
    try{
      const r = await fetch('/api/auth',{cache:'no-store'});
      configured = !!(await r.json()).configured;
    }catch(e){
      enter();
      return;
    }

    if(configured){
      title.textContent = 'Inserisci la password';
      hint.textContent = 'Inserisci la password per accedere alla pianificazione.';
      pass2Row.style.display = 'none';
      btn.textContent = 'Entra';
    }else{
      title.textContent = 'Imposta la password';
      hint.textContent = 'Primo avvio: scegli una password. Sarà richiesta ai prossimi avvii.';
      pass2Row.style.display = '';
      btn.textContent = 'Imposta ed entra';
    }
    setTimeout(()=>pass1.focus(),50);

    async function submit(){
      showErr('');
      const p1 = pass1.value;
      if(!p1){ showErr('Inserisci la password.'); pass1.focus(); return; }
      btn.disabled = true;
      try{
        if(configured){
          const r = await fetch('/api/auth/check',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p1})});
          if(!(await r.json()).ok){
            showErr('Password errata.'); pass1.value=''; pass1.focus(); btn.disabled=false; return;
          }
        }else{
          if(p1 !== pass2.value){ showErr('Le due password non coincidono.'); btn.disabled=false; return; }
          const r = await fetch('/api/auth/set',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p1})});
          if(!(await r.json()).ok){ showErr('Impossibile impostare la password.'); btn.disabled=false; return; }
        }
        enter();
      }catch(e){
        showErr('Errore di comunicazione. Riprova.'); btn.disabled=false;
      }
    }

    btn.addEventListener('click',submit);
    pass1.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); submit(); } });
    pass2.addEventListener('keydown',e=>{ if(e.key==='Enter'){ e.preventDefault(); submit(); } });
  }

  // Mantiene attivo il programma di avvio solo mentre la pagina è aperta.
  setInterval(()=>fetch('/api/ping',{method:'POST'}).catch(()=>{}),20000);

  function cloneData(value){
    return JSON.parse(JSON.stringify(value));
  }

  function pushUndo(label){
    undoStack.push({
      label:label || 'Modifica',
      state:cloneData(state),
      activeYear,
      activeMonth,
      selectedDateKey
    });
    if(undoStack.length > UNDO_LIMIT) undoStack.shift();
    updateUndoButton();
  }

  function updateUndoButton(){
    // Ctrl+Z remains available; no visible button is shown to keep the interface clean.
  }

  function setAutoPlanStatus(message,warning=false){
    if(!els.autoPlanStatus) return;
    els.autoPlanStatus.textContent = message;
    els.autoPlanStatus.classList.toggle('warn',Boolean(warning));
  }

  function undoLastAction(){
    const snapshot = undoStack.pop();
    if(!snapshot){
      setAutoPlanStatus('Nessuna modifica da annullare');
      updateUndoButton();
      return;
    }
    state = snapshot.state;
    invalidateMonthRulesCache();
    activeYear = snapshot.activeYear;
    activeMonth = snapshot.activeMonth;
    selectedDateKey = snapshot.selectedDateKey;
    saveState();
    renderAll();
    setAutoPlanStatus(`Annullata: ${snapshot.label}`);
    updateUndoButton();
  }

  function dateKey(d){
    const y = d.getFullYear();
    const m = String(d.getMonth()+1).padStart(2,'0');
    const day = String(d.getDate()).padStart(2,'0');
    return `${y}-${m}-${day}`;
  }

  function monthKey(year, month){
    return `${year}-${String(month+1).padStart(2,'0')}`;
  }

  function parseDateKey(key){
    const [y,m,d] = key.split('-').map(Number);
    return new Date(y,m-1,d);
  }

  function daysInMonth(year, month){
    return new Date(year, month+1, 0).getDate();
  }

  function easterSunday(year){
    const a = year % 19;
    const b = Math.floor(year / 100);
    const c = year % 100;
    const d = Math.floor(b / 4);
    const e = b % 4;
    const f = Math.floor((b + 8) / 25);
    const g = Math.floor((b - f + 1) / 3);
    const h = (19 * a + b - d - g + 15) % 30;
    const i = Math.floor(c / 4);
    const k = c % 4;
    const l = (32 + 2 * e + 2 * i - h - k) % 7;
    const m = Math.floor((a + 11 * h + 22 * l) / 451);
    const month = Math.floor((h + l - 7 * m + 114) / 31) - 1;
    const day = ((h + l - 7 * m + 114) % 31) + 1;
    return new Date(year, month, day);
  }

  function italianHolidays(year){
    const fixed = [
      [0,1,'Capodanno'],
      [0,6,'Epifania'],
      [3,25,'Festa della Liberazione'],
      [4,1,'Festa dei Lavoratori'],
      [5,2,'Festa della Repubblica'],
      [7,15,'Ferragosto'],
      [10,1,'Ognissanti'],
      [11,8,'Immacolata Concezione'],
      [11,25,'Natale'],
      [11,26,'Santo Stefano']
    ];
    const map = new Map();
    fixed.forEach(([m,d,n]) => map.set(dateKey(new Date(year,m,d)), n));
    const pasqua = easterSunday(year);
    const pasquetta = new Date(pasqua);
    pasquetta.setDate(pasqua.getDate()+1);
    map.set(dateKey(pasquetta), 'Lunedì dell’Angelo');
    state.customHolidays
      .filter(h => h.date.startsWith(String(year)))
      .forEach(h => map.set(h.date, h.name || 'Festività aziendale'));
    return map;
  }

  function getDayInfo(d){
    const holidays = italianHolidays(d.getFullYear());
    const key = dateKey(d);
    const weekend = d.getDay() === 0 || d.getDay() === 6;
    const fest = holidays.has(key);
    const closed = Boolean(COMPANY_CLOSED_DATES[key]);
    let type = 'FERIALE';
    if(closed && fest) type = 'FEST/CHIUSO';
    else if(closed) type = 'CHIUSO';
    else if(weekend && fest) type = 'WKEND/FEST';
    else if(weekend) type = 'WKEND';
    else if(fest) type = 'FEST';
    return {
      key, weekend, fest, closed, type,
      holidayName: COMPANY_CLOSED_DATES[key] || holidays.get(key) || ''
    };
  }

  function ensureMonth(){
    const key = monthKey(activeYear, activeMonth);
    state.schedules[key] ||= {};
    return state.schedules[key];
  }

  function getShift(staffId, dKey){
    const month = dKey.slice(0,7);
    return state.schedules[month]?.[dKey]?.[staffId] || '';
  }

  function setShiftValue(staffId, dKey, value){
    const month = dKey.slice(0,7);
    state.schedules[month] ||= {};
    state.schedules[month][dKey] ||= {};
    if(value) state.schedules[month][dKey][staffId] = value;
    else delete state.schedules[month][dKey][staffId];
  }

  function setShift(staffId, dKey, value){
    setShiftValue(staffId,dKey,value);
    saveState();
  }

  function manualCellKey(staffId,dKey){
    return `${staffId}|${dKey}`;
  }

  function isManualCell(staffId,dKey){
    return Object.prototype.hasOwnProperty.call(state.manualCells || {},manualCellKey(staffId,dKey));
  }

  function setManualShift(staffId,dKey,value){
    state.manualCells ||= {};
    state.manualCells[manualCellKey(staffId,dKey)] = value;
    clearShiftLeaderForCell(staffId,dKey,value);
    setShiftValue(staffId,dKey,value);
    state.pendingReplanFrom = minDateKey([state.pendingReplanFrom,dKey]);
  }

  function releaseManualCell(staffId,dKey){
    if(state.manualCells) delete state.manualCells[manualCellKey(staffId,dKey)];
  }

  function shiftLeaderKey(dKey,shift){
    return `${dKey}|${shift}`;
  }

  function isShiftLeader(staffId,dKey,shift){
    return state.shiftLeaders?.[shiftLeaderKey(dKey,shift)] === staffId;
  }

  function pruneShiftLeaders(){
    state.shiftLeaders ||= {};
    Object.entries(state.shiftLeaders).forEach(([key,staffId]) => {
      const [dKey,shift] = key.split('|');
      if(!isWorkShift(shift) || getShift(staffId,dKey) !== shift) delete state.shiftLeaders[key];
    });
  }

  function clearShiftLeaderForCell(staffId,dKey,value){
    Object.entries(state.shiftLeaders || {}).forEach(([key,leaderId]) => {
      const [leaderDate,leaderShift] = key.split('|');
      if(leaderId === staffId && leaderDate === dKey && leaderShift !== value) delete state.shiftLeaders[key];
    });
  }

  function shiftLeaderBlockKeys(staffId,dKey,shift){
    const keys = [dKey];
    let cursor = addDays(parseDateKey(dKey),-1);
    while(getShift(staffId,dateKey(cursor)) === shift){
      keys.unshift(dateKey(cursor));
      cursor = addDays(cursor,-1);
    }
    cursor = addDays(parseDateKey(dKey),1);
    while(getShift(staffId,dateKey(cursor)) === shift){
      keys.push(dateKey(cursor));
      cursor = addDays(cursor,1);
    }
    return keys.filter(key => !isHistoricalDate(key));
  }

  function toggleShiftLeader(staffId,dKey,shift){
    if(!isWorkShift(shift) || getShift(staffId,dKey) !== shift || isHistoricalDate(dKey)) return;
    pushUndo(`Capoturno ${formatConflictDate(dKey)} ${shift}`);
    state.shiftLeaders ||= {};
    const blockKeys = shiftLeaderBlockKeys(staffId,dKey,shift);
    const selectedForWholeBlock = blockKeys.every(key => state.shiftLeaders[shiftLeaderKey(key,shift)] === staffId);
    blockKeys.forEach(key => {
      const leaderKey = shiftLeaderKey(key,shift);
      if(selectedForWholeBlock) delete state.shiftLeaders[leaderKey];
      else state.shiftLeaders[leaderKey] = staffId;
    });
    saveState();
    refreshPlanningKeepScroll();
  }

  function toggleSelectedShiftLeader(){
    const selected = normalizeRange(selectedRange);
    if(selected.r1 !== selected.r2 || selected.c1 !== selected.c2){
      setAutoPlanStatus('Selezionare una sola cella modificabile con turno M, P, N o GG.',true);
      return;
    }
    const person = state.staff[selected.r1];
    const dKey = dateKey(new Date(activeYear,activeMonth,selected.c1+1));
    const shift = person ? getShift(person.id,dKey) : '';
    if(!person || isHistoricalDate(dKey) || !isWorkShift(shift)){
      setAutoPlanStatus('Selezionare una sola cella modificabile con turno M, P, N o GG.',true);
      return;
    }
    toggleShiftLeader(person.id,dKey,shift);
  }

  function normalizeRange(range){
    return {
      r1:Math.min(range.startRow,range.endRow),
      r2:Math.max(range.startRow,range.endRow),
      c1:Math.min(range.startCol,range.endCol),
      c2:Math.max(range.startCol,range.endCol)
    };
  }

  function updateRangeSelection(){
    const {r1,r2,c1,c2} = normalizeRange(selectedRange);
    document.querySelectorAll('.schedule-cell').forEach(cell => {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      cell.classList.toggle('range-selected',row >= r1 && row <= r2 && col >= c1 && col <= c2);
    });
  }

  function selectScheduleCell(row,col,extend=false){
    activeCell = {row,col};
    if(extend){
      selectedRange.endRow = row;
      selectedRange.endCol = col;
    }else{
      selectedRange = {startRow:row,startCol:col,endRow:row,endCol:col};
    }
    updateRangeSelection();
  }

  function selectedCellsMatrix(){
    const {r1,r2,c1,c2} = normalizeRange(selectedRange);
    const matrix = [];
    for(let row=r1;row<=r2;row++){
      const line = [];
      for(let col=c1;col<=c2;col++){
        const cell = document.querySelector(`.schedule-cell[data-row="${row}"][data-col="${col}"]`);
        line.push(cell ? getShift(cell.dataset.staffId,cell.dataset.date) : '');
      }
      matrix.push(line);
    }
    return matrix;
  }

  function matrixToText(matrix){
    return matrix.map(row => row.join('\t')).join('\n');
  }

  function parseClipboardText(textValue){
    // I codici ritirati restano incollabili: copiare e incollare una riga
    // storica non deve svuotare le celle che li contengono.
    const canonical = new Map(
      [...SHIFT_OPTIONS,...LEGACY_SHIFT_CODES].map(code => [code.toUpperCase(),code])
    );
    return String(textValue || '').replace(/\r/g,'').split('\n').filter((line,index,all)=>!(index===all.length-1 && line==='')).map(line =>
      line.split('\t').map(value => {
        const normalized = String(value || '').trim().toUpperCase();
        return canonical.get(normalized) || '';
      })
    );
  }

  function copySelection(event=null){
    const matrix = selectedCellsMatrix();
    internalClipboard = matrix;
    const plain = matrixToText(matrix);
    if(event?.clipboardData){
      event.clipboardData.setData('text/plain',plain);
      event.preventDefault();
    }else if(navigator.clipboard?.writeText){
      navigator.clipboard.writeText(plain).catch(()=>{});
    }
    setAutoPlanStatus(`Copiate ${matrix.length * (matrix[0]?.length || 0)} celle.`);
  }

  function pasteMatrix(matrix){
    if(!matrix?.length) return;
    const changes = [];
    matrix.forEach((rowValues,rowOffset) => {
      rowValues.forEach((value,colOffset) => {
        const row = activeCell.row + rowOffset;
        const col = activeCell.col + colOffset;
        const cell = document.querySelector(`.schedule-cell[data-row="${row}"][data-col="${col}"]`);
        if(cell) changes.push({staffId:cell.dataset.staffId,date:cell.dataset.date,value});
      });
    });
    if(!changes.length) return;
    selectedRange = {
      startRow:activeCell.row,startCol:activeCell.col,
      endRow:activeCell.row + matrix.length - 1,
      endCol:activeCell.col + Math.max(...matrix.map(row=>row.length),1) - 1
    };
    applyScheduleChanges(changes,`Incolla ${changes.length} celle`);
  }

  function clearDragPreview(){
    document.querySelectorAll('.schedule-cell.drag-preview,.schedule-cell.drag-source').forEach(cell => {
      cell.classList.remove('drag-preview','drag-source');
    });
  }

  function updateDragPreview(){
    clearDragPreview();
    if(!dragFill.active) return;
    const r1 = Math.min(dragFill.startRow,dragFill.endRow);
    const r2 = Math.max(dragFill.startRow,dragFill.endRow);
    const c1 = Math.min(dragFill.startCol,dragFill.endCol);
    const c2 = Math.max(dragFill.startCol,dragFill.endCol);
    document.querySelectorAll('.schedule-cell').forEach(cell => {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      if(row >= r1 && row <= r2 && col >= c1 && col <= c2){
        cell.classList.add('drag-preview');
      }
    });
    dragFill.source?.classList.add('drag-source');
  }

  function beginDragFill(event,cell,value){
    event.preventDefault();
    event.stopPropagation();
    dragFill = {
      active:true,
      startRow:Number(cell.dataset.row),
      startCol:Number(cell.dataset.col),
      endRow:Number(cell.dataset.row),
      endCol:Number(cell.dataset.col),
      value,
      source:cell
    };
    document.body.classList.add('drag-filling');
    updateDragPreview();
  }

  function moveDragFill(event){
    if(!dragFill.active) return;
    const target = document.elementFromPoint(event.clientX,event.clientY)?.closest('.schedule-cell');
    if(!target) return;
    const row = Number(target.dataset.row);
    const col = Number(target.dataset.col);
    if(row === dragFill.endRow && col === dragFill.endCol) return;
    dragFill.endRow = row;
    dragFill.endCol = col;
    updateDragPreview();
  }

  function finishDragFill(){
    if(!dragFill.active) return;
    const r1 = Math.min(dragFill.startRow,dragFill.endRow);
    const r2 = Math.max(dragFill.startRow,dragFill.endRow);
    const c1 = Math.min(dragFill.startCol,dragFill.endCol);
    const c2 = Math.max(dragFill.startCol,dragFill.endCol);
    const cells = Array.from(document.querySelectorAll('.schedule-cell')).filter(cell => {
      const row = Number(cell.dataset.row);
      const col = Number(cell.dataset.col);
      return row >= r1 && row <= r2 && col >= c1 && col <= c2;
    });
    const changes = cells.map(cell => ({
      staffId:cell.dataset.staffId,
      date:cell.dataset.date,
      value:dragFill.value
    }));
    if(cells.length){
      selectedDateKey = cells[cells.length-1].dataset.date;
      selectedRange = {startRow:r1,startCol:c1,endRow:r2,endCol:c2};
      activeCell = {row:r1,col:c1};
    }
    dragFill.active = false;
    document.body.classList.remove('drag-filling');
    clearDragPreview();
    applyScheduleChanges(changes,`Riempimento di ${cells.length} celle`);
  }

  function emptyValidation(){
    return {cell:{}, day:{}, personMonth:{}, month:[]};
  }

  function isWorkShift(shift){
    return WORK_SHIFTS.includes(shift);
  }

  function currentMonthContains(dKey){
    return dKey.startsWith(monthKey(activeYear,activeMonth));
  }

  function addUnique(arr, item, keyFn){
    const key = keyFn(item);
    if(!arr.some(x => keyFn(x) === key)) arr.push(item);
  }

  function addDayConflict(result, dKey, code, message){
    result.day[dKey] ||= [];
    addUnique(result.day[dKey], {code,message,date:dKey}, x => `${x.code}|${x.message}`);
    addUnique(result.month, {code,message,date:dKey,staffId:null}, x => `${x.code}|${x.date}|${x.staffId || ''}|${x.message}`);
  }

  function addCellConflict(result, staffId, dKey, code, message){
    const key = `${staffId}|${dKey}`;
    result.cell[key] ||= [];
    addUnique(result.cell[key], {code,message,date:dKey,staffId}, x => `${x.code}|${x.message}`);
    const person = state.staff.find(p => p.id === staffId);
    result.day[dKey] ||= [];
    addUnique(
      result.day[dKey],
      {code,message:`${person?.name || 'Persona'}: ${message}`,date:dKey,staffId},
      x => `${x.code}|${x.staffId || ''}|${x.message}`
    );
    addUnique(result.month, {code,message,date:dKey,staffId}, x => `${x.code}|${x.date}|${x.staffId || ''}|${x.message}`);
  }

  function addPersonMonthConflict(result, staffId, code, message){
    result.personMonth[staffId] ||= [];
    addUnique(result.personMonth[staffId], {code,message,staffId}, x => `${x.code}|${x.message}`);
    addUnique(result.month, {code,message,date:null,staffId}, x => `${x.code}|${x.staffId || ''}|${x.message}`);
  }

  function getCellConflicts(staffId, dKey){
    return validation.cell[`${staffId}|${dKey}`] || [];
  }

  function personHasMonthConflict(staffId){
    if(validation.personMonth[staffId]?.length) return true;
    return Object.keys(validation.cell).some(key => key.startsWith(`${staffId}|`) && key.split('|')[1].startsWith(monthKey(activeYear,activeMonth)));
  }

  function dateHasConflict(dKey){
    return (validation.day[dKey] || []).length > 0;
  }

  function normalizeName(name){
    return String(name || '').toUpperCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim();
  }

  function findSpecialPerson(id, containsText){
    return state.staff.find(p => p.id === id) ||
      state.staff.find(p => normalizeName(p.name).includes(containsText));
  }

  function isDegrandi(person){
    return person?.id === 'degrandi-roberto' || normalizeName(person?.name).includes('DEGRANDI');
  }

  // Unico turno di lavoro ammesso per Degrandi in una data, secondo la sua
  // regola individuale fissa (DEGRANDI_RULE_TEXT). '' significa che quel
  // giorno non gli si assegna alcun turno di lavoro:
  // - lunedì-venerdì: solo GG. Un festivo infrasettimanale resta senza turno,
  //   perché il punto 4 di "regola globale" vieta GG nei festivi.
  // - sabato: solo M.
  // - domenica: mai.
  function degrandiRequiredShift(d,info){
    const dayOfWeek = d.getDay();
    if(dayOfWeek === 0) return '';
    if(dayOfWeek === 6) return 'M';
    return info.fest ? '' : 'GG';
  }

  // Testo del conflitto per cella, allineato a degrandiRequiredShift.
  function degrandiShiftMessage(d,info){
    const required = degrandiRequiredShift(d,info);
    if(required === 'GG') return 'dal lunedì al venerdì può lavorare soltanto in GG.';
    if(required === 'M') return 'il sabato può lavorare soltanto in M.';
    if(d.getDay() === 0) return 'la domenica non lavora mai.';
    return 'in un festivo infrasettimanale non gli si assegna alcun turno: GG non è ammesso nei festivi e la M è riservata al sabato.';
  }

  // Sabati già assegnati in M nel mese indicato, esclusa la cella in esame
  // quando è passata (excludeKey): il tetto va valutato sul resto del mese.
  function degrandiSaturdayMCount(personId,year,month,excludeKey){
    let count = 0;
    const nDays = daysInMonth(year,month);
    for(let day=1;day<=nDays;day += 1){
      const d = new Date(year,month,day);
      if(d.getDay() !== 6) continue;
      const key = dateKey(d);
      if(key === excludeKey) continue;
      if(getShift(personId,key) === 'M') count += 1;
    }
    return count;
  }

  // Vincoli di IDENTITÀ della persona: valgono da soli su una cella isolata,
  // senza guardare i giorni vicini. Sono l'insieme che nemmeno una cella
  // manuale può violare, perché non sono preferenze ma qualifiche e regole
  // individuali fisse.
  //
  // Volutamente PIÙ STRETTO di hardAssignmentAllowed, che valuta anche riposi,
  // rotazione e giorni consecutivi leggendo le celle attorno: durante la
  // ripianificazione quelle celle non sono ancora state riscritte, quindi
  // usare il gate completo libererebbe celle manuali che il PM ha messo
  // apposta.
  function violatesFixedIndividualRule(person,dKey,shift){
    if(!person || !isWorkShift(shift) || !rulesApplyTo(dKey)) return false;
    if(person.can[shift] === false) return true;
    if(isDegrandi(person)){
      const d = parseDateKey(dKey);
      return shift !== degrandiRequiredShift(d,getDayInfo(d));
    }
    return false;
  }

  function fixedIndividualRuleReason(person,dKey,shift){
    if(person && person.can[shift] === false) return `non è abilitato al turno ${shift}`;
    if(isDegrandi(person)){
      const d = parseDateKey(dKey);
      return degrandiShiftMessage(d,getDayInfo(d)).replace(/\.$/,'');
    }
    return 'viola una regola individuale fissa';
  }

  function fixedIndividualRuleRejectionText(rejected){
    return rejected.map(change => {
      const person = state.staff.find(p => p.id === change.staffId);
      const name = person ? person.name : change.staffId;
      return `${name} ${formatConflictDate(change.date)} - ${fixedIndividualRuleReason(person,change.date,change.value)}`;
    }).join('; ');
  }

  function isCipolla(person){
    return person?.id === 'cipolla-eugenio' || normalizeName(person?.name).includes('CIPOLLA');
  }

  function isGrassis(person){
    return person?.id === 'grassis-marco' || normalizeName(person?.name).includes('GRASSIS');
  }

  // Regola individuale fissa di GRASSIS MARCO: l'automatico lavora solo con
  // blocchi P -> M -> P; sabato solo M e domenica nessun turno. Le celle
  // manuali restano modificabili, ma la validazione mostra l'eventuale deroga.
  function grassisShiftAllowed(person,dKey,shift){
    const d = parseDateKey(dKey);
    const day = d.getDay();
    if(day === 0) return false;
    if(day === 6) return shift === 'M';
    if(!['M','P'].includes(shift)) return false;
    const previousShift = getShift(person.id,dateKey(addDays(d,-1)));
    if(previousShift === shift) return true;
    const previousBlockShift = lastCompletedRotationShift(person.id,dKey);
    if(previousBlockShift === 'P') return shift === 'M';
    if(previousBlockShift === 'M') return shift === 'P';
    return shift === 'P';
  }

  function grassisShiftMessage(person,dKey,shift){
    const d = parseDateKey(dKey);
    const day = d.getDay();
    if(day === 0) return 'la domenica non può ricevere turni automatici.';
    if(day === 6) return 'il sabato può lavorare soltanto in M.';
    if(!['M','P'].includes(shift)) return 'nei feriali può lavorare soltanto in M o P.';
    const previousShift = getShift(person.id,dateKey(addDays(d,-1)));
    if(previousShift === shift) return 'il blocco corrente può solo proseguire nello stesso turno.';
    const previousBlockShift = lastCompletedRotationShift(person.id,dKey);
    if(previousBlockShift === 'P') return 'dopo un blocco P il blocco successivo deve essere M.';
    if(previousBlockShift === 'M') return 'dopo un blocco M il blocco successivo deve essere P.';
    return 'il primo blocco automatico deve essere P.';
  }

  function isCominelli(person){
    return person?.id === 'cominelli-rosalino' || normalizeName(person?.name).includes('COMINELLI');
  }

  function isMonthlyPlannedStatus(shift,dKey){
    // Lo storico prima del 01/09/2026 mantiene il conteggio originario. Da
    // quella data ogni stato non vuoto conta, esclusi soltanto . e RIPOSO.
    if(dKey < GLOBAL_RULES_EFFECTIVE_FROM){
      return isWorkShift(shift) || PAID_NON_SHIFT_STATUSES.includes(shift);
    }
    if(shift === 'FERIE'){
      const day = parseDateKey(dKey).getDay();
      if(day === 0 || day === 6) return false;
    }
    return shift !== '' && shift !== '.' && shift !== 'RIPOSO';
  }

  function addDays(date, amount){
    const d = new Date(date);
    d.setDate(d.getDate()+amount);
    return d;
  }

  function rulesApplyTo(dKey){
    return dKey >= RULES_EFFECTIVE_FROM;
  }

  function minimumRestHours(previousShift,nextShift){
    if(!isWorkShift(previousShift) || !isWorkShift(nextShift)) return Infinity;
    // M 06:00-14:00, P 14:00-22:00, N 22:00-06:00, GG 09:00-18:00.
    const ends = {M:14,P:22,N:30,GG:18};
    const starts = {M:6,P:14,N:22,GG:9};
    return 24 + starts[nextShift] - ends[previousShift];
  }

  function respectsMinimumRest(previousShift,nextShift){
    if(previousShift === 'P' && nextShift === 'N') return false;
    return minimumRestHours(previousShift,nextShift) >= 11;
  }

  function weekStartFor(dKey){
    const d = parseDateKey(dKey);
    const daysSinceMonday = (d.getDay() + 6) % 7;
    return dateKey(addDays(d,-daysSinceMonday));
  }

  function feriePeopleInWeek(weekStartKey, extraStaffId=null){
    const people = new Set();
    const first = parseDateKey(weekStartKey);
    eachDate(first,addDays(first,6),d => {
      const dKey = dateKey(d);
      state.staff.forEach(person => {
        if(getShift(person.id,dKey) === 'FERIE') people.add(person.id);
      });
    });
    if(extraStaffId) people.add(extraStaffId);
    return people;
  }

  function firstFerieWeekOverflow(staffId,startKey,endKey){
    const seen = new Set();
    let overflow = null;
    eachDate(parseDateKey(startKey),parseDateKey(endKey),d => {
      if(overflow) return;
      const weekStart = weekStartFor(dateKey(d));
      if(seen.has(weekStart)) return;
      seen.add(weekStart);
      if(feriePeopleInWeek(weekStart,staffId).size > activeRules().maxWeeklyFeriePeople) overflow = weekStart;
    });
    return overflow;
  }

  function eachDate(start, end, callback){
    const cursor = new Date(start);
    while(cursor <= end){
      callback(new Date(cursor));
      cursor.setDate(cursor.getDate()+1);
    }
  }

  function monthlyWorkingDayLimit(year, month){
    let count = 0;
    const total = daysInMonth(year,month);
    for(let day=1;day<=total;day++){
      const d = new Date(year,month,day);
      const info = getDayInfo(d);
      if(d.getDay() !== 0 && d.getDay() !== 6 && !info.fest) count++;
    }
    return count;
  }

  function monthlyWorkingDayTarget(year, month){
    const standard = monthlyWorkingDayLimit(year,month);
    const override = Number(state?.monthlyWorkingDayOverrides?.[monthKey(year,month)]);
    return Number.isInteger(override) && override >= 1 && override <= 31 ? override : standard;
  }


  function systemTodayStart(){
    const now = new Date();
    return new Date(now.getFullYear(),now.getMonth(),now.getDate());
  }

  function editableMonthFloorKey(){
    const today = systemTodayStart();
    const previousMonth = new Date(today.getFullYear(),today.getMonth()-1,1);
    return monthKey(previousMonth.getFullYear(),previousMonth.getMonth());
  }

  function isHistoricalMonth(year,month){
    return monthKey(year,month) < editableMonthFloorKey();
  }

  function isHistoricalDate(dKey){
    return dKey.slice(0,7) < editableMonthFloorKey();
  }

  function historicalMonthMessage(){
    const [year,month] = editableMonthFloorKey().split('-').map(Number);
    return `Mese storico bloccato: si possono modificare solo ${MONTHS[month-1]} ${year} e i mesi successivi.`;
  }

  function cellKey(staffId,dKey){
    return `${staffId}|${dKey}`;
  }

  function minDateKey(keys){
    return keys.filter(Boolean).sort()[0] || null;
  }

  function repairStartFor(changedDateKey){
    // Imported months are historical data. Automatic planning starts no
    // earlier than September 2026, regardless of the rolling manual lock.
    const protectedThrough = state.historySeeds?.protectedThrough;
    const historyFloor = /^\d{4}-\d{2}$/.test(protectedThrough || '')
      ? `${protectedThrough}-01`
      : null;
    // Giorni già trascorsi rispetto alla data reale odierna restano protetti
    // anche dentro il mese corrente: editableMonthFloorKey() protegge solo a
    // livello di mese, quindi da solo lascerebbe ripianificabili i giorni già
    // passati del mese in corso. La pianificazione automatica riparte sempre
    // da oggi (incluso) in avanti, mai da un giorno già passato (richiesta PM
    // 2026-08-06).
    const todayFloor = dateKey(systemTodayStart());
    return [changedDateKey,AUTO_PLANNING_EFFECTIVE_FROM,historyFloor,`${editableMonthFloorKey()}-01`,todayFloor].filter(Boolean).sort().at(-1);
  }

  function conflictsFrom(result,startKey){
    return result.month.filter(item => !item.date || item.date >= startKey);
  }

  function validationSignature(item){
    return `${item.code}|${item.date || ''}|${item.staffId || ''}|${item.message}`;
  }

  function newRuleViolationsForChanges(changes){
    const baseline = validateSchedule();
    const baselineKeys = new Set(baseline.month.map(validationSignature));
    const original = changes.map(change => ({...change,value:getShift(change.staffId,change.date)}));
    changes.forEach(change => setShiftValue(change.staffId,change.date,change.value));
    const proposed = validateSchedule();
    original.forEach(change => setShiftValue(change.staffId,change.date,change.value));
    const changedStaff = new Set(changes.map(change => change.staffId));
    const changedDates = new Set(changes.map(change => change.date));
    return proposed.month.filter(item =>
      !baselineKeys.has(validationSignature(item)) &&
      (changedStaff.has(item.staffId) || changedDates.has(item.date))
    );
  }

  // Punto 15 di "regola globale": un weekend e' la coppia sabato+domenica,
  // identificata dalla data del sabato. Si conta dentro il mese della cella,
  // quindi un weekend a cavallo (sab 31 / dom 1) vale in entrambi i mesi e la
  // regola prosegue dal mese precedente (punto 16).
  function weekendIdFor(dKey){
    const d = parseDateKey(dKey);
    if(d.getDay() === 6) return dKey;
    if(d.getDay() === 0) return dateKey(addDays(d,-1));
    return '';
  }

  function weekendIdsInMonth(year,month){
    const ids = new Set();
    for(let day=1;day<=daysInMonth(year,month);day += 1){
      const id = weekendIdFor(dateKey(new Date(year,month,day)));
      if(id) ids.add(id);
    }
    return ids;
  }

  function workedWeekendIds(personId,year,month){
    const ids = new Set();
    for(let day=1;day<=daysInMonth(year,month);day += 1){
      const key = dateKey(new Date(year,month,day));
      const id = weekendIdFor(key);
      if(id && isWorkShift(getShift(personId,key))) ids.add(id);
    }
    return ids;
  }

  // Un nuovo weekend non e' ammesso se porterebbe la persona a lavorarli tutti.
  function weekendCapAllows(person,info,shift){
    if(!isWorkShift(shift) || !rulesApplyTo(info.key) || info.key < GLOBAL_RULES_EFFECTIVE_FROM) return true;
    const id = weekendIdFor(info.key);
    if(!id) return true;
    const d = parseDateKey(info.key);
    const worked = workedWeekendIds(person.id,d.getFullYear(),d.getMonth());
    if(worked.has(id)) return true;
    return worked.size + 1 <= weekendIdsInMonth(d.getFullYear(),d.getMonth()).size - 1;
  }

  // Punto 17: massimo di persone per turno, configurabile nel pannello regole.
  function maxCoverageFor(info){
    if(info.closed) return {M:31,P:31,N:31};
    const rules = activeRules();
    if(info.weekend || info.fest) return {M:rules.maxWeekendM,P:rules.maxWeekendP,N:rules.maxWeekendN};
    return {M:rules.maxWeekdayM,P:rules.maxWeekdayP,N:rules.maxWeekdayN};
  }

  function hardAssignmentAllowed(person,info,shift){
    if(!isWorkShift(shift)) return true;
    if(person.can[shift] === false) return false;
    if(!weekendCapAllows(person,info,shift)) return false;
    if(['M','P','N'].includes(shift) && info.key >= GLOBAL_RULES_EFFECTIVE_FROM && getShift(person.id,info.key) !== shift
       && getCountsForDate(info.key).coverage[shift] >= maxCoverageFor(info)[shift]) return false;
    // Regola inderogabile: ogni assegnazione automatica deve lasciare almeno
    // 11 ore di riposo sia dal turno del giorno precedente sia verso quello
    // del giorno successivo. Questo controllo e' nel gate hard condiviso da
    // pianificazione, riparazioni e coperture d'emergenza: non esistono
    // deroghe automatiche (es. P -> M il giorno successivo = 8 ore, vietato).
    if(rulesApplyTo(info.key)){
      const d = parseDateKey(info.key);
      const previousShift = getShift(person.id,dateKey(addDays(d,-1)));
      const nextShift = getShift(person.id,dateKey(addDays(d,1)));
      if(!respectsMinimumRest(previousShift,shift) || !respectsMinimumRest(shift,nextShift)) return false;
    }
    if((info.weekend || info.fest) && ['M','P','N'].includes(shift) && person.can['WKENDFES'+shift] === false) return false;
    // Regola 4: la giornata (GG) vale solo dal lunedì al venerdì (aggiornata
    // dalla PM sulla scheda Excel "regola globale" punto 4, 2026-08-06);
    // weekend e festivi non ammettono mai GG, per nessuna persona.
    if(rulesApplyTo(info.key) && (info.weekend || info.fest) && shift === 'GG') return false;
    // Regola inderogabile valida per TUTTE le persone (richiesta PM
    // 2026-08-07): dopo MAX_CONSECUTIVE_GG_DAYS giorni consecutivi di GG serve
    // 1 giorno di riposo. Quindi il giorno che segue un blocco di 5 GG non può
    // ricevere alcun turno di lavoro (nemmeno un altro GG), e un blocco di GG
    // non può mai superare i 5 giorni nemmeno saldandosi con GG già presenti
    // nei giorni successivi. Nessuna deroga per carenza di copertura.
    if(rulesApplyTo(info.key)){
      const ggBefore = countAdjacentDays(person.id,info.key,value => value === 'GG',-1);
      if(ggBefore >= MAX_CONSECUTIVE_GG_DAYS) return false;
      if(shift === 'GG'){
        const ggAfter = countAdjacentDays(person.id,info.key,value => value === 'GG',1);
        if(ggBefore + 1 + ggAfter > MAX_CONSECUTIVE_GG_DAYS) return false;
      }
    }
    const dayOfWeek = parseDateKey(info.key).getDay();
    if(rulesApplyTo(info.key) && dayOfWeek >= 1 && dayOfWeek <= 5 && isCominelli(person) && shift !== 'GG') return false;
    // DEGRANDI ROBERTO - regola individuale fissa e inderogabile
    // (DEGRANDI_RULE_TEXT). Sta qui, e non solo nei chiamanti, perché anche i
    // passaggi di riparazione passano da hardAssignmentAllowed: è l'unico
    // punto che tutte le scritture automatiche attraversano.
    if(rulesApplyTo(info.key) && isDegrandi(person)){
      const day = parseDateKey(info.key);
      if(shift !== degrandiRequiredShift(day,info)) return false;
      // Tetto mensile dei sabati in M: la cella in esame è ancora vuota
      // quando la funzione viene chiamata, quindi il conteggio non la include.
      if(shift === 'M' && dayOfWeek === 6
         && degrandiSaturdayMCount(person.id,day.getFullYear(),day.getMonth()) >= DEGRANDI_MAX_SATURDAY_M) return false;
      // Il riposo può stare ovunque, ma mai dopo più di
      // DEGRANDI_MAX_CONSECUTIVE_WORK_DAYS giorni di lavoro consecutivi.
      const before = countAdjacentDays(person.id,info.key,isWorkShift,-1);
      const after = countAdjacentDays(person.id,info.key,isWorkShift,1);
      if(before + 1 + after > DEGRANDI_MAX_CONSECUTIVE_WORK_DAYS) return false;
    }
    // Sta nel gate hard condiviso: candidateAllowed e tutte le riparazioni
    // post-pass lo attraversano, comprese le deroghe alla rotazione generale.
    if(rulesApplyTo(info.key) && isGrassis(person) && !grassisShiftAllowed(person,info.key,shift)) return false;
    return true;
  }

  function plannerState(){
    return {
      workRun:0,
      nightRun:0,
      lastWorkShift:'',
      // Punto 6 di "regola globale": turno dell'ultimo blocco M/N/P
      // completato, usato per imporre la rotazione mattina->notte->
      // pomeriggio->mattina. A differenza di lastWorkShift non viene mai
      // azzerato durante i giorni di riposo.
      rotationLastShift:'',
      sameShiftRun:0,
      recoveryRestRemaining:0,
      monthlyWorkCount:0,
      // Blocchi M/N/P iniziati DENTRO l'orizzonte ripianificato (azzerato da
      // autoRepairFrom dopo la ricostruzione dello storico). Finché vale 0 la
      // persona non ha ancora una fase di rotazione assegnata in questo
      // orizzonte e può esserle scelta; vedi candidateAllowed.
      horizonBlocks:0,
      // Regola 12 (2026-08-06, T1): 7 contatori indipendenti per il target
      // storico per colonna. shiftCounts resta SOLO feriale (M/P/N/GG);
      // weekendFestShiftCounts copre M/P/N su weekend+festivo fuso (GG non
      // ha mai una variante weekend/festivo, vedi il blocco a riga 2050 in
      // hardAssignmentAllowed, quindi resta feriale per costruzione).
      // weekendFestCount resta l'aggregato preesistente, invariato: la
      // formula di score che lo usa (candidateScore) non fa parte di questo
      // cambio.
      shiftCounts:{M:0,P:0,N:0,GG:0},
      weekendFestShiftCounts:{M:0,P:0,N:0},
      weekendFestCount:0
    };
  }

  function advancePlannerDay(ps,shift,d){
    const work = isWorkShift(shift);
    if(work){
      ps.workRun += 1;
      if(ps.lastWorkShift === shift) ps.sameShiftRun += 1;
      else {
        // Punto 6: memorizza il turno dell'ultimo blocco completato (M/N/P)
        // per la rotazione, prima di sovrascrivere lastWorkShift con il
        // nuovo blocco appena iniziato. GG non è un turno (punto 4) e non
        // aggiorna la memoria di rotazione.
        if(SHIFT_ROTATION_ORDER.includes(ps.lastWorkShift)) ps.rotationLastShift = ps.lastWorkShift;
        ps.lastWorkShift = shift;
        ps.sameShiftRun = 1;
        // Un nuovo blocco M/N/P consuma la libertà di scelta della fase.
        if(SHIFT_ROTATION_ORDER.includes(shift)) ps.horizonBlocks += 1;
      }
      if(shift === 'N') ps.nightRun += 1;
      else ps.nightRun = 0;
      if(d.getFullYear() === activeYear && d.getMonth() === activeMonth){
        const info = getDayInfo(d);
        if(info.weekend || info.fest){
          ps.weekendFestCount += 1;
          if(ps.weekendFestShiftCounts[shift] !== undefined){
            ps.weekendFestShiftCounts[shift] = (ps.weekendFestShiftCounts[shift] || 0) + 1;
          }
        }else{
          ps.shiftCounts[shift] = (ps.shiftCounts[shift] || 0) + 1;
        }
      }
    }else{
      // Punto 11 di "regola globale" (l'etichetta storica "Regola 9" era il
      // punto sbagliato): se il blocco appena concluso terminava con la
      // notte servono sempre 2 giorni di riposo, qualunque sia la lunghezza
      // del blocco. Questo giorno è già il primo dei due.
      const endedWithNight = ps.nightRun > 0;
      // Punto 6: memorizza il turno dell'ultimo blocco completato (M/N/P)
      // per la rotazione prima di azzerare lastWorkShift. A differenza di
      // lastWorkShift, rotationLastShift sopravvive ai giorni di riposo.
      if(SHIFT_ROTATION_ORDER.includes(ps.lastWorkShift)) ps.rotationLastShift = ps.lastWorkShift;
      ps.workRun = 0;
      ps.nightRun = 0;
      ps.lastWorkShift = '';
      ps.sameShiftRun = 0;
      if(endedWithNight) ps.recoveryRestRemaining = activeRules().restAfterNights - 1;
      else if(ps.recoveryRestRemaining > 0) ps.recoveryRestRemaining -= 1;
    }
    if(d.getFullYear() === activeYear && d.getMonth() === activeMonth && isMonthlyPlannedStatus(shift,dateKey(d))){
      ps.monthlyWorkCount += 1;
    }
  }

  function buildPlannerStates(startDate){
    const map = new Map(state.staff.map(person => [person.id,plannerState()]));
    const historyStart = addDays(new Date(activeYear,activeMonth,1),-45);
    const historyEnd = addDays(startDate,-1);
    if(historyEnd < historyStart) return map;
    eachDate(historyStart,historyEnd,d => {
      state.staff.forEach(person => advancePlannerDay(map.get(person.id),getShift(person.id,dateKey(d)),d));
    });
    return map;
  }

  function assignedPeopleForDate(dKey){
    const result = {M:[],P:[],N:[],GG:[]};
    state.staff.forEach(person => {
      const shift = getShift(person.id,dKey);
      if(result[shift]) result[shift].push(person.id);
    });
    return result;
  }

  function assignedCoverageCount(assigned,shift){
    return assigned[shift].length;
  }

  function dayHasCoverageShortage(info,assigned){
    // Regola 6: la giornata non raggiunge i numeri minimi con il personale
    // già assegnato. È la sola condizione che autorizza il 6° giorno
    // consecutivo e la deroga al blocco settimanale nello stesso turno.
    const targets = targetsFor(info);
    return ['M','P','N'].some(code => assignedCoverageCount(assigned,code) < targets[code]);
  }

  function dateHasCoverageShortage(dKey){
    const info = getDayInfo(parseDateKey(dKey));
    const targets = targetsFor(info);
    const {coverage} = getCountsForDate(dKey);
    return ['M','P','N'].some(code => coverage[code] < targets[code]);
  }

  function maxConsecutiveWorkDaysFor(shortage){
    // Il sesto giorno è una deroga generale limitata al recupero di un turno
    // scoperto; il settimo resta sempre vietato.
    return shortage ? MAX_CONSECUTIVE_WORK_DAYS_SHORTAGE : MAX_CONSECUTIVE_WORK_DAYS;
  }

  function isHighLevel(person){
    return normalizeLevel(person?.level) === 'ALTO';
  }

  function assignedHighCount(assignedIds){
    return assignedIds.reduce((count,id) => count + (isHighLevel(state.staff.find(p=>p.id===id)) ? 1 : 0),0);
  }

  function specialPairConflict(personId,shift,assigned){
    const cipolla = findSpecialPerson('cipolla-eugenio','CIPOLLA');
    const grassis = findSpecialPerson('grassis-marco','GRASSIS');
    if(!cipolla || !grassis) return false;
    if(personId === cipolla.id && assigned[shift].includes(grassis.id)) return true;
    if(personId === grassis.id && assigned[shift].includes(cipolla.id)) return true;
    return false;
  }


  function requiresCompanion(info){
    // SILVIO MORELLO: "non può lavorare da solo weekend". Il vincolo vale
    // soltanto su sabato, domenica e festivi, dove la copertura minima è
    // ridotta; nei giorni feriali può essere l'unico di un turno.
    return info.weekend || info.fest;
  }

  function weekDateKeys(weekStartKey){
    const monday = parseDateKey(weekStartKey);
    return Array.from({length:7},(_,offset)=>dateKey(addDays(monday,offset)));
  }

  function fullWeekIsInsideActiveMonth(weekStartKey){
    const currentMonth = monthKey(activeYear,activeMonth);
    return weekDateKeys(weekStartKey).some(key => key.slice(0,7) === currentMonth);
  }

  function weekHasProtectedInterruption(personId,weekStartKey){
    return weekDateKeys(weekStartKey).some(key => {
      const value = getShift(personId,key);
      return Boolean(value) && !isWorkShift(value);
    });
  }

  function weekHasAnyWork(personId,weekStartKey){
    return weekDateKeys(weekStartKey).some(key => isWorkShift(getShift(personId,key)));
  }

  function sameShiftRunsInWeek(personId,weekStartKey,overrides={}){
    const runs = [];
    let current = null;
    weekDateKeys(weekStartKey).forEach((dKey,index) => {
      const shift = Object.prototype.hasOwnProperty.call(overrides,dKey) ? overrides[dKey] : getShift(personId,dKey);
      if(isWorkShift(shift) && current && current.shift === shift){
        current.keys.push(dKey);
        current.endIndex = index;
      }else{
        if(current) runs.push(current);
        current = isWorkShift(shift) ? {shift,keys:[dKey],startIndex:index,endIndex:index} : null;
      }
    });
    if(current) runs.push(current);
    return runs.sort((a,b) => b.keys.length-a.keys.length || a.startIndex-b.startIndex);
  }

  function hasInvalidSameShiftRun(personId,weekStartKey,overrides={}){
    return sameShiftRunsInWeek(personId,weekStartKey,overrides)
      .some(run => run.keys.length < effectiveMinSameShiftDays());
  }

  function allSameShiftRunsMeetMinimum(personId,weekStartKey,overrides={}){
    return !hasInvalidSameShiftRun(personId,weekStartKey,overrides);
  }

  function sameShiftRunAt(personId,dKey,overrides={}){
    const valueAt = key => Object.prototype.hasOwnProperty.call(overrides,key) ? overrides[key] : getShift(personId,key);
    const shift = valueAt(dKey);
    if(!isWorkShift(shift)) return {shift:'',keys:[]};
    const keys = [dKey];
    let cursor = addDays(parseDateKey(dKey),-1);
    while(valueAt(dateKey(cursor)) === shift){
      keys.unshift(dateKey(cursor));
      cursor = addDays(cursor,-1);
    }
    cursor = addDays(parseDateKey(dKey),1);
    while(valueAt(dateKey(cursor)) === shift){
      keys.push(dateKey(cursor));
      cursor = addDays(cursor,1);
    }
    return {shift,keys};
  }

  function prospectiveSameShiftRunMeetsMinimum(person,dKey,shift){
    if(!rulesApplyTo(dKey) || !isWorkShift(shift)) return true;
    const run = sameShiftRunAt(person.id,dKey,{[dKey]:shift});
    if(run.keys.length > MAX_SAME_SHIFT_DAYS) return false;
    const minimum = effectiveMinSameShiftDays();
    if(run.keys.length >= minimum) return true;
    if(isGrassis(person)){
      let cursor = addDays(parseDateKey(run.keys[run.keys.length-1]),1);
      for(let remaining=minimum-run.keys.length;remaining>0;remaining -= 1){
        const key = dateKey(cursor);
        const info = getDayInfo(cursor);
        const day = cursor.getDay();
        if(!currentMonthContains(key) || isHistoricalDate(key) || isManualCell(person.id,key) || getShift(person.id,key)) return false;
        if(!['M','P'].includes(shift) || day === 0 || (day === 6 && shift !== 'M')) return false;
        if(person.can[shift] === false || ((info.weekend || info.fest) && person.can['WKENDFES'+shift] === false)) return false;
        cursor = addDays(cursor,1);
      }
      return true;
    }
    const potentialKeys = [];
    [-1,1].forEach(direction => {
      let cursor = addDays(parseDateKey(direction < 0 ? run.keys[0] : run.keys[run.keys.length-1]),direction);
      while(true){
        const key = dateKey(cursor);
        if(!currentMonthContains(key) || isHistoricalDate(key) || isManualCell(person.id,key) || getShift(person.id,key)) break;
        if(!hardAssignmentAllowed(person,getDayInfo(cursor),shift)) break;
        potentialKeys.push(key);
        cursor = addDays(cursor,direction);
      }
    });
    return run.keys.length + potentialKeys.length >= minimum;
  }

  function trailingSameShiftRunBeforeDate(personId,d){
    const monday = parseDateKey(weekStartFor(dateKey(d)));
    let cursor = addDays(d,-1);
    if(cursor < monday) return {shift:'',count:0};
    const shift = getShift(personId,dateKey(cursor));
    if(!isWorkShift(shift)) return {shift:'',count:0};
    let count = 0;
    while(cursor >= monday && getShift(personId,dateKey(cursor)) === shift){
      count += 1;
      cursor = addDays(cursor,-1);
    }
    return {shift,count};
  }

  function remainingDaysInWeek(d){
    return 7 - ((d.getDay() + 6) % 7);
  }

  function candidateAllowed(person,shift,d,info,ps,assigned,target,monthlyLimit,lockedCells,enforceMonthlyLimit=true,relaxWeeklyBlock=false){
    if(lockedCells.has(cellKey(person.id,info.key))) return false;
    if(getShift(person.id,info.key)) return false;
    if(!hardAssignmentAllowed(person,info,shift)) return false;
    if(ps.recoveryRestRemaining > 0) return false;
    // Punto 11 di "regola globale" (l'etichetta storica "Regola 9" era il
    // punto sbagliato): dentro un blocco di notti si può soltanto proseguire
    // con N. Qualsiasi altro turno chiuderebbe il blocco senza i 2 giorni di
    // riposo.
    if(rulesApplyTo(info.key) && ps.nightRun > 0 && shift !== 'N') return false;
    // Punto 6: un nuovo blocco su un turno diverso da quello in corso deve
    // rispettare la rotazione mattina->notte->pomeriggio->mattina e non può
    // iniziare lo stesso giorno in cui finisce il blocco precedente (serve
    // sempre almeno un giorno di riposo fra due blocchi diversi). GG non è
    // un turno (punto 4) e resta fuori da questo controllo. Se il turno
    // atteso dalla rotazione è uno che la persona non può fare (can.X
    // false, non selezionato), si salta al turno successivo della
    // rotazione che può fare, invece di bloccarla per il resto del mese
    // (bug segnalato dalla PM 2026-08-06).
    if(rulesApplyTo(info.key) && SHIFT_ROTATION_ORDER.includes(shift) && ps.lastWorkShift !== shift){
      if(SHIFT_ROTATION_ORDER.includes(ps.lastWorkShift)) return false;
      const expectedNext = nextAllowedRotationShift(person,ps.rotationLastShift);
      // Punto 6 resta rigido: M -> riposo -> N -> riposo -> P -> riposo -> M,
      // saltando i turni che la persona non può fare. L'unica libertà è QUALE
      // FASE occupa ciascuna persona, e si esercita una sola volta, sul primo
      // blocco della ripianificazione (horizonBlocks === 0): da lì in poi la
      // sequenza è vincolata.
      //
      // Serve perché la fase ereditata dallo storico è la stessa per quasi
      // tutti: avanzando tutti di un passo a settimana, la squadra resta un
      // blocco unico e ogni settimana un turno va in sovrannumero mentre un
      // altro resta scoperto (misurato su ottobre 2026: M=6/P=4/N=1 e
      // M=7/P=3/N=1 contro i minimi 3/3/2). Ridistribuendo le persone sulle
      // tre fasi la settimana tipo diventa circa 4/4/5 e i minimi si coprono
      // senza toccare l'ordine del ciclo (richiesta PM 2026-08-07: "人可以打乱，
      // 规则不能打乱").
      const canChoosePhase = ps.horizonBlocks === 0 && shift !== ps.rotationLastShift;
      if(expectedNext && shift !== expectedNext && !canChoosePhase) return false;
    }
    if(ps.workRun >= maxConsecutiveWorkDaysFor(dayHasCoverageShortage(info,assigned))) return false;
    if(rulesApplyTo(info.key) && ps.lastWorkShift === shift && ps.sameShiftRun >= maxConsecutiveWorkDaysFor(dayHasCoverageShortage(info,assigned))) return false;
    const weekStart = weekStartFor(info.key);
    // La deroga per carenza di personale vale solo se il turno candidato è
    // davvero quello scoperto quel giorno, non per qualunque turno solo
    // perché un altro turno risulta corto.
    // Il blocco settimanale minimo non si applica a Degrandi: la sua regola
    // individuale fissa (DEGRANDI_RULE_TEXT) determina già il turno di ogni
    // giorno, quindi non c'è alcun blocco da comporre.
    const weeklyBlockApplies = !isDegrandi(person);
    if(weeklyBlockApplies && rulesApplyTo(info.key) && d.getDay() === 1 && fullWeekIsInsideActiveMonth(weekStart) && ps.lastWorkShift === shift && ps.sameShiftRun > MAX_SAME_SHIFT_DAYS - effectiveMinSameShiftDays()) return false;
    if(weeklyBlockApplies && rulesApplyTo(info.key) && fullWeekIsInsideActiveMonth(weekStart) && !weekHasProtectedInterruption(person.id,weekStart)){
      const trailing = trailingSameShiftRunBeforeDate(person.id,d);
      if(trailing.count > 0 && trailing.count < effectiveMinSameShiftDays() && shift !== trailing.shift) return false;
      if(trailing.count === 0 && remainingDaysInWeek(d) < effectiveMinSameShiftDays()) return false;
    }
    const previousKey = dateKey(addDays(d,-1));
    if(rulesApplyTo(info.key) && !respectsMinimumRest(getShift(person.id,previousKey),shift)) return false;
    if(enforceMonthlyLimit && ps.monthlyWorkCount >= monthlyLimit) return false;
    // Il vincolo di turno di Degrandi è interamente in hardAssignmentAllowed,
    // già chiamato da questa funzione: la sua regola individuale fissa
    // (DEGRANDI_RULE_TEXT) non dipende dalla copertura del giorno.
    if(specialPairConflict(person.id,shift,assigned)) return false;
    if(isHighLevel(person) && assignedHighCount(assigned[shift]) >= 1) return false;
    if(!prospectiveSameShiftRunMeetsMinimum(person,info.key,shift)) return false;

    const silvio = findSpecialPerson('silvio-morello','SILVIO MORELLO');
    if(silvio && person.id === silvio.id && requiresCompanion(info) && target === 1 && assigned[shift].length === 0) return false;
    return true;
  }

  // Regola 12 (2026-08-06, T1): due fasce di tolleranza indipendenti per
  // ciascuna delle 7 colonne di HISTORICAL_SHIFT_QUOTA_PCT (M/P/N/GG
  // feriale, WKENDFESM/WKENDFESP/WKENDFESN weekend+festivo fuso), calcolate
  // sul dato storico individuale invece della ripartizione uniforme, colonna
  // per colonna (mai sommando feriale + weekend/festivo). Fascia 1:
  // percentuale di tabella +-0.1%, convertita in giorni con arrotondamento
  // half-up su ciascun estremo (Math.round su valori non negativi già
  // arrotonda per eccesso sullo .5, quindi equivale a "round half up");
  // dentro la fascia nessuna penalità (zona morta). Fascia 2 (+-0.2%) si
  // applica solo alla singola cella persona/colonna quando la fascia 1 non è
  // raggiungibile per capacità mensile residua (il conteggio corrente supera
  // già il limite superiore — i contatori non possono scendere — oppure
  // anche assegnando tutti i giorni ancora disponibili nel mese non
  // basterebbe a raggiungere il limite inferiore: è il proxy scoring-layer
  // del blocco imposto dalle regole hard — tetto mensile, minimi di
  // copertura, blocco settimanale stesso turno, riposo dopo notte,
  // compagno di Silvio — che restano tutte fuori da questa funzione). Fuori
  // anche dalla fascia 2 non si forza nulla qui: resta un conflitto
  // visibile, esposto da historicalQuotaCellStatus per il task di reporting
  // T2. 3 celle restano escluse per intero (nessuna fascia, nessuna
  // pressione, comportamento storico naturale).
  const HISTORICAL_QUOTA_EXEMPT_CELLS = new Set([
    'cominelli-rosalino:WKENDFESM',
    'andrea-paonessa:WKENDFESN',
    'meneghin-marco:WKENDFESN',
    // Le due colonne M di Degrandi non sono più raggiungibili: la sua regola
    // individuale fissa (DEGRANDI_RULE_TEXT) vieta la M dal lunedì al venerdì
    // (colonna M) e limita la M del sabato a DEGRANDI_MAX_SATURDAY_M al mese
    // (colonna WKENDFESM). Senza esenzione lo storico produrrebbe una fascia
    // impossibile da rispettare e un conflitto permanente.
    'degrandi-roberto:M',
    'degrandi-roberto:WKENDFESM'
  ]);

  function historicalQuotaColumnKey(shift,info){
    return (info.weekend || info.fest) ? 'WKENDFES'+shift : shift;
  }

  function historicalQuotaColumnCount(ps,column){
    return column.indexOf('WKENDFES') === 0 ?
      (ps.weekendFestShiftCounts[column.slice('WKENDFES'.length)] || 0) :
      (ps.shiftCounts[column] || 0);
  }

  function historicalQuotaBand(pct,widen){
    const total = monthlyWorkingDayTarget(activeYear,activeMonth);
    const delta = widen ? 0.002 : 0.001;
    return {
      lower: Math.round((pct - delta) * total),
      upper: Math.round((pct + delta) * total)
    };
  }

  // Stato di una cella persona/colonna rispetto alla fascia di tolleranza
  // applicabile (fascia 1, o fascia 2 se la 1 non è raggiungibile). Ritorna
  // null per le persone senza riga storica, per le colonne assenti e per le
  // 3 celle esentate. Riusabile dal task T2 per segnalare le celle fuori
  // fascia senza ricalcolare la logica.
  function historicalQuotaCellStatus(person,ps,column){
    const pct = HISTORICAL_SHIFT_QUOTA_PCT[person.id];
    if(!pct || pct[column] === undefined) return null;
    if(HISTORICAL_QUOTA_EXEMPT_CELLS.has(person.id+':'+column)) return null;
    const total = monthlyWorkingDayTarget(activeYear,activeMonth);
    const current = historicalQuotaColumnCount(ps,column);
    const band1 = historicalQuotaBand(pct[column],false);
    const remainingCapacity = Math.max(0,total - ps.monthlyWorkCount);
    const pass1Infeasible = current > band1.upper || (current + remainingCapacity) < band1.lower;
    const band = pass1Infeasible ? historicalQuotaBand(pct[column],true) : band1;
    const inBand = current >= band.lower && current <= band.upper;
    return {
      current,
      target: Math.round(pct[column] * total),
      band,
      pass1Infeasible,
      inBand,
      deviation: inBand ? 0 : (current < band.lower ? band.lower - current : current - band.upper)
    };
  }

  // T2 (segnalazione conflitti, task separato, non usata dallo scoring):
  // somma dei 7 target arrotondati di una persona e verifica se rientra
  // nello stesso intervallo della Regola 8
  // ([monthlyLimit - giorni rinunciabili, monthlyLimit]).
  // Esposta solo perché il reporting di T2 possa richiamarla; qui non altera
  // in alcun modo l'assegnazione.
  function historicalQuotaTargetsSum(person){
    const pct = HISTORICAL_SHIFT_QUOTA_PCT[person.id];
    if(!pct) return null;
    const total = monthlyWorkingDayTarget(activeYear,activeMonth);
    const columns = ['M','P','N','GG','WKENDFESM','WKENDFESP','WKENDFESN'];
    const sum = columns.reduce((acc,column) => acc + Math.round((pct[column]||0) * total),0);
    return {sum, monthlyLimit: total, inRange: sum >= total - activeRules().waivedWorkDays && sum <= total};
  }

  const HISTORICAL_QUOTA_COLUMNS = ['M','P','N','GG','WKENDFESM','WKENDFESP','WKENDFESN'];

  // T2 (segnalazione conflitti, task separato, non usata dallo scoring):
  // ricalcola i 7 conteggi per colonna direttamente dal dato salvato
  // (getShift) per il mese attivo, con la stessa logica giorno-per-giorno di
  // getDayInfo/historicalQuotaColumnKey usata dallo scoring live. Serve una
  // fonte indipendente dallo stato del planner perché ps.shiftCounts e
  // ps.weekendFestShiftCounts riflettono solo l'ultima sessione di
  // pianificazione automatica, non necessariamente il salvataggio finale se
  // sono seguite modifiche manuali (stessa fonte dati già usata dal
  // controllo TURNI_MESE_NON_EQUILIBRATI più sotto, qui solo divisa sulle 7
  // colonne invece delle 4 di historicalMonthlyShiftQuota).
  function computeHistoricalQuotaMonthCounts(person){
    const nDays = daysInMonth(activeYear,activeMonth);
    const counts = {M:0,P:0,N:0,GG:0,WKENDFESM:0,WKENDFESP:0,WKENDFESN:0};
    for(let day=1;day<=nDays;day++){
      const d = new Date(activeYear,activeMonth,day);
      const shift = getShift(person.id,dateKey(d));
      if(!isWorkShift(shift)) continue;
      const column = historicalQuotaColumnKey(shift,getDayInfo(d));
      if(Object.prototype.hasOwnProperty.call(counts,column)) counts[column] += 1;
    }
    return counts;
  }

  function shiftSpreadPenalty(person,ps,shift,info){
    const historicalPct = HISTORICAL_SHIFT_QUOTA_PCT[person.id];
    if(historicalPct){
      const column = historicalQuotaColumnKey(shift,info);
      if(historicalPct[column] !== undefined){
        const status = historicalQuotaCellStatus(person,ps,column);
        if(!status || status.inBand) return 0;
        const sign = status.current < status.band.lower ? -1 : 1;
        return sign * status.deviation * 18;
      }
    }
    // Regola 12: scostamento dalla ripartizione uniforme fra i turni che la
    // persona può realmente coprire, misurato contro la quota mensile
    // individuale (non più contro la media della sessione corrente). Un
    // turno già sopra la propria quota viene penalizzato, uno sotto quota
    // premiato. Fallback invariato per le persone senza riga in
    // HISTORICAL_SHIFT_QUOTA_PCT (punto 4 della richiesta T1).
    const usable = WORK_SHIFTS.filter(code => person.can[code] !== false);
    if(usable.length < 2) return 0;
    const quota = monthlyShiftQuota(person);
    const target = quota[shift];
    if(target === undefined) return 0;
    return (((ps.shiftCounts[shift]||0) + (ps.weekendFestShiftCounts[shift]||0)) - target) * 18;
  }

  function candidateScore(person,shift,info,ps,oldAssignments){
    let score = ps.monthlyWorkCount * 100;
    // Regola 12 (rif. tabella "regola individuali"): scostamento personale
    // dalla ripartizione uniforme dei turni, calcolato da shiftSpreadPenalty.
    score += shiftSpreadPenalty(person,ps,shift,info);
    score += ps.workRun * 8;
    // Punto 15: di norma 2 weekend al mese per persona. Un nuovo weekend costa
    // di piu' a chi ne ha gia' fatti, e molto di piu' oltre la norma.
    if(info.weekend && info.key >= GLOBAL_RULES_EFFECTIVE_FROM){
      const id = weekendIdFor(info.key);
      const d = parseDateKey(info.key);
      const worked = workedWeekendIds(person.id,d.getFullYear(),d.getMonth());
      if(!worked.has(id)){
        score += worked.size * 40;
        if(worked.size >= activeRules().maxWeekendsPerPerson) score += 250;
      }
    }
    // Regola 8: nudge verso il blocco minimo di giorni consecutivi
    // giorni consecutivi nello stesso turno. Si applica solo mentre il blocco
    // corrente (ps.sameShiftRun, conteggiato prima del giorno odierno) è
    // ancora sotto il minimo richiesto; una volta raggiunto il minimo la
    // regola non chiede di proseguire a oltranza, quindi il termine torna
    // neutro (0) invece di continuare a premiare/penalizzare a pieno ±55.
    if(ps.lastWorkShift && ps.sameShiftRun < effectiveMinSameShiftDays()){
      if(ps.lastWorkShift === shift) score -= 55;
      else score += 55;
    }
    score += state.staff.findIndex(p => p.id === person.id) / 100;
    // Perturbazione deterministica della combinazione corrente. Vale 0 sulla
    // combinazione 1, quindi il comportamento storico è intatto. Il valore
    // resta sotto 4, cioè sotto il più piccolo scalino vero del punteggio
    // (workRun = 8): può solo riordinare candidati sostanzialmente pari, mai
    // scavalcare una differenza reale di carico o di quota.
    score += variantJitter(person.id,shift);
    return score;
  }

  function addSilvioCompanion(d,info,planner,assigned,oldAssignments,monthlyLimit,lockedCells){
    if(!requiresCompanion(info)) return;
    const silvio = findSpecialPerson('silvio-morello','SILVIO MORELLO');
    if(!silvio) return;
    const shift = getShift(silvio.id,info.key);
    if(!isWorkShift(shift) || assigned[shift].length >= 2) return;

    // Silvio may be an existing manual input. In that case retain him and
    // add one compatible colleague: this is an extra assignment required by
    // the personal safety rule, not a daily maximum or capacity target.
    // Anche qui il tetto mensile resta inderogabile (PM 2026-08-07): se non
    // c'è un compagno disponibile sotto il tetto non se ne forza uno oltre,
    // il conflitto resta visibile e va risolto a mano. Con SILVIO MORELLO
    // impostato a solo GG questo ramo non si attiva più, perché GG è un turno
    // feriale e requiresCompanion riguarda solo weekend e festivi.
    const companion = state.staff
      .filter(person => person.id !== silvio.id)
      .filter(person => candidateAllowed(person,shift,d,info,planner.get(person.id),assigned,2,monthlyLimit,lockedCells,true))
      .sort((a,b) => candidateScore(a,shift,info,planner.get(a.id),oldAssignments) - candidateScore(b,shift,info,planner.get(b.id),oldAssignments))[0];
    if(!companion) return;
    setShiftValue(companion.id,info.key,shift);
    assigned[shift].push(companion.id);
  }

  function chooseAutomaticShift(person,d,info,ps,assigned,monthlyLimit,lockedCells,oldAssignments){
    const forced = [];
    const weekStart = weekStartFor(info.key);
    const trailing = trailingSameShiftRunBeforeDate(person.id,d);
    if(rulesApplyTo(info.key) && isCominelli(person) && d.getDay() >= 1 && d.getDay() <= 5) forced.push('GG');
    else if(fullWeekIsInsideActiveMonth(weekStart) && !weekHasProtectedInterruption(person.id,weekStart) && trailing.count > 0 && trailing.count < effectiveMinSameShiftDays()) forced.push(trailing.shift);

    const hasOtherShifts = ['M','P','N'].some(code => person.can[code] !== false);
    const preferences = [...new Set([...forced,'N','P','M',...(hasOtherShifts ? [] : ['GG'])])];
    let options = preferences
      .filter(shift => candidateAllowed(person,shift,d,info,ps,assigned,2,monthlyLimit,lockedCells,true));

    // Regola 6: quando la giornata non raggiunge i numeri minimi si può
    // ricorrere a un turno diverso da quello del blocco settimanale. È una
    // via d'uscita per coprire il giorno, non la norma: si applica soltanto
    // se il percorso stretto non offre alternative.
    if(!options.length && dayHasCoverageShortage(info,assigned)){
      options = preferences
        .filter(shift => candidateAllowed(person,shift,d,info,ps,assigned,2,monthlyLimit,lockedCells,true,true));
    }

    // All'inizio della settimana evita di proseguire il turno del weekend se causerebbe più di 5 giorni uguali consecutivi.
    if(d.getDay() === 1 && trailing.count === 0 && ps.lastWorkShift && ps.sameShiftRun > MAX_SAME_SHIFT_DAYS - effectiveMinSameShiftDays()){
      const alternatives = options.filter(shift => shift !== ps.lastWorkShift);
      if(alternatives.length) options = alternatives;
      else return {shift:'',forced:false};
    }

    // Regole 1-4 (copertura minima giornaliera, hard): quando fra le opzioni
    // ammesse per questa persona c'è almeno un turno ancora sotto il proprio
    // target di copertura (M/P/N secondo targetsFor; GG non ha mai un target
    // e resta sempre fuori da questo filtro — è un turno di riserva, non
    // prioritario per la copertura), le opzioni si restringono SOLO a quei
    // turni: non è più un semplice criterio di ordinamento, ma un vincolo
    // vero (bug segnalato dalla PM 2026-08-06, T2 — il commento dichiarava
    // "hard" un meccanismo che in realtà era solo uno spareggio di punteggio
    // e non bloccava mai la scelta di un turno già a target). candidateScore
    // resta il criterio di spareggio dentro il gruppo così ristretto. Se
    // nessuna delle opzioni ammesse è ancora sotto target, la persona può
    // comunque ricevere un turno già a target: repairDailyCoverageBySwitching
    // resta la rete di sicurezza secondaria per i casi realmente infattibili
    // qui (per esempio quando tutti sono già al tetto mensile).
    const belowTarget = shift => assignedCoverageCount(assigned,shift) < (targetsFor(info)[shift]||0);
    const belowTargetOptions = options.filter(belowTarget);
    if(belowTargetOptions.length) options = belowTargetOptions;
    options.sort((a,b) => candidateScore(person,a,info,ps,oldAssignments) - candidateScore(person,b,info,ps,oldAssignments));
    const chosen = options[0] || '';
    return {shift:chosen, forced:forced.includes(chosen)};
  }

  function fillPlannedWorkingDay(d,info,planner,assigned,oldAssignments,monthlyLimit,lockedCells){
    if(info.closed) return;
    // L'ordine con cui si scorrono le persone decide chi ha la prima scelta a
    // parità di punteggio: è la leva che genera combinazioni diverse a ogni
    // pressione del pulsante. Con la combinazione 1 l'ordine è quello di
    // sempre.
    staffInVariantOrder().forEach(person => {
      if(getShift(person.id,info.key)) return;
      const ps = planner.get(person.id);
      if(ps.monthlyWorkCount >= monthlyLimit) return;
      const choice = chooseAutomaticShift(person,d,info,ps,assigned,monthlyLimit,lockedCells,oldAssignments);
      const shift = choice.shift;
      if(!shift) return;
      // Non si aggiunge personale a un turno che ha già raggiunto il proprio
      // minimo, salvo continuità di blocco settimanale forzata.
      //
      // Prima il freno valeva solo su weekend e festivi. Con il tetto mensile
      // reso inderogabile il budget di ciascuno è una risorsa scarsa: un
      // giorno speso su un turno già coperto è un giorno che manca a una
      // giornata scoperta più avanti nel mese, e con la rotazione rigida non
      // esiste più modo di rimediarci dopo (uno scambio di turno in mezzo alla
      // settimana violerebbe il punto 6). Misurato su set-dic 2026: surplus
      // di 36-46 giorni-persona al mese contro carenze di 12-27 negli stessi
      // mesi, cioè personale in eccesso e giornate scoperte in contemporanea.
      // GG resta fuori dal freno: il punto 4 dice che non è un turno e non
      // conta nei minimi, infatti targetsFor gli assegna 0. Trattarlo come
      // "già a target" lo rendeva di fatto non assegnabile e lasciava chi fa
      // solo GG molto sotto il minimo mensile (SILVIO MORELLO a 12 giorni su
      // 21 ammessi).
      if(!choice.forced && shift !== 'GG' && assignedCoverageCount(assigned,shift) >= targetsFor(info)[shift]){
        return;
      }
      setShiftValue(person.id,info.key,shift);
      assigned[shift].push(person.id);
    });
  }

  function promoteAssignedToGG(info,assigned){
    // Regola aggiornata: GG non copre più M né P nel conteggio della
    // copertura, quindi spostare qualcuno su GG non soddisfa più i minimi di
    // M o P — questa promozione non ha più senso ed è disattivata.
    return;
  }

  function countAdjacentDays(personId,dKey,predicate,direction){
    let count = 0;
    let cursor = addDays(parseDateKey(dKey),direction);
    while(predicate(getShift(personId,dateKey(cursor)))){
      count += 1;
      cursor = addDays(cursor,direction);
    }
    return count;
  }

  function isNightRecoveryDay(personId,dKey){
    // Regola 9: i 2 giorni che seguono una notte sono di riposo obbligatorio,
    // a meno che il blocco prosegua con un'altra notte. Se uno dei 2 giorni
    // precedenti è N, questo giorno appartiene al recupero.
    const d = parseDateKey(dKey);
    for(let offset=1;offset<=activeRules().restAfterNights;offset += 1){
      if(getShift(personId,dateKey(addDays(d,-offset))) === 'N') return true;
    }
    return false;
  }

  function createsNightRecoveryConflict(personId,dKey,shift){
    if(shift !== 'N') return false;
    const d = parseDateKey(dKey);
    // Se il giorno dopo è ancora N il blocco non si chiude qui.
    if(getShift(personId,dateKey(addDays(d,1))) === 'N') return false;
    for(let offset=1;offset<=activeRules().restAfterNights;offset += 1){
      if(isWorkShift(getShift(personId,dateKey(addDays(d,offset))))) return true;
    }
    return false;
  }

  function lastCompletedRotationShift(personId,dKey){
    // Punto 6 di "regola globale": risale ai giorni precedenti dKey (cella
    // ancora vuota nel punto di chiamata) finché non trova l'ultimo giorno
    // M/N/P. GG e i giorni di riposo/assenza sono trasparenti (non sono un
    // turno, punto 4) e vengono scavalcati. Limite di 366 giorni solo come
    // guardia contro dati anomali.
    let cursor = addDays(parseDateKey(dKey),-1);
    for(let i=0;i<366;i += 1){
      const value = getShift(personId,dateKey(cursor));
      if(SHIFT_ROTATION_ORDER.includes(value)) return value;
      cursor = addDays(cursor,-1);
    }
    return '';
  }

  function violatesRotationOrder(person,dKey,shift){
    // Punto 6: mattina -> riposo -> notte -> riposo -> pomeriggio -> riposo
    // -> mattina. Vale solo quando shift inizia un nuovo blocco (il giorno
    // precedente ha un turno diverso); continuare lo stesso turno non è mai
    // un nuovo blocco. Se la persona non può fare il turno atteso (can.X
    // false), la rotazione salta al turno successivo che può fare, invece
    // di bloccarla per il resto del mese (bug segnalato dalla PM
    // 2026-08-06).
    if(!SHIFT_ROTATION_ORDER.includes(shift)) return false;
    const previous = getShift(person.id,dateKey(addDays(parseDateKey(dKey),-1)));
    if(previous === shift) return false;
    if(SHIFT_ROTATION_ORDER.includes(previous)) return true;
    const expectedNext = nextAllowedRotationShift(person,lastCompletedRotationShift(person.id,dKey));
    return Boolean(expectedNext) && shift !== expectedNext;
  }

  // allowRotationBreak: deroga prevista dal punto 9 di "regola globale" — "un
  // turno diverso che copre la giornata mancante". Si usa SOLO quando un turno
  // resterebbe a ZERO persone, cioè scoperto del tutto. Restano comunque
  // verificate abilitazioni, riposo di 11 h, riposo dopo le notti e tetto
  // mensile: si deroga all'ORDINE della rotazione, non alla sicurezza.
  function postPassAssignmentAllowed(person,dKey,shift,ignoreMonthlyLimit,allowRotationBreak){
    if(getShift(person.id,dKey)) return false;
    // Punto 7 di "regola globale" (bug segnalato dalla PM 2026-08-07): nessun
    // passaggio di riparazione può portare una persona oltre il tetto mensile.
    // completeWeeklyConsecutiveBlocks aggiungeva giorni senza alcun controllo
    // (misurato su ottobre 2026: +6 giorni in una sola chiamata, CIPOLLA da 22
    // a 26) affidandosi solo alla ripulitura successiva; quando la ripulitura
    // non è possibile, quei giorni restano nel piano consegnato.
    // ignoreMonthlyLimit serve a chi compensa da sé, liberando altrove tanti
    // giorni quanti ne aggiunge (vedi completeWeeklyConsecutiveBlocks).
    if(!ignoreMonthlyLimit && exceedsMonthlyLimit(person,dKey,shift)) return false;
    const d = parseDateKey(dKey);
    const info = getDayInfo(d);
    if(!hardAssignmentAllowed(person,info,shift)) return false;
    if(isWorkShift(shift) && shift !== 'N' && isNightRecoveryDay(person.id,dKey)) return false;
    if(shift === 'N' && isNightRecoveryDay(person.id,dKey) && getShift(person.id,dateKey(addDays(d,-1))) !== 'N') return false;
    if(createsNightRecoveryConflict(person.id,dKey,shift)) return false;
    if(rulesApplyTo(dKey) && !allowRotationBreak && violatesRotationOrder(person,dKey,shift)) return false;
    const previousShift = getShift(person.id,dateKey(addDays(d,-1)));
    const nextShift = getShift(person.id,dateKey(addDays(d,1)));
    if(!respectsMinimumRest(previousShift,shift) || !respectsMinimumRest(shift,nextShift)) return false;
    const workBefore = countAdjacentDays(person.id,dKey,isWorkShift,-1);
    const workAfter = countAdjacentDays(person.id,dKey,isWorkShift,1);
    if(workBefore + 1 + workAfter > maxConsecutiveWorkDaysFor(dateHasCoverageShortage(dKey))) return false;
    const sameBefore = countAdjacentDays(person.id,dKey,value => value === shift,-1);
    const sameAfter = countAdjacentDays(person.id,dKey,value => value === shift,1);
    if(sameBefore + 1 + sameAfter > maxConsecutiveWorkDaysFor(dateHasCoverageShortage(dKey))) return false;

    const assigned = assignedPeopleForDate(dKey);
    // Il vincolo di turno di Degrandi è interamente in hardAssignmentAllowed,
    // chiamato in testa a questa funzione: non serve ripeterlo qui.
    if(specialPairConflict(person.id,shift,assigned)) return false;
    if(isHighLevel(person) && assignedHighCount(assigned[shift]) >= 1) return false;
    if(!prospectiveSameShiftRunMeetsMinimum(person,dKey,shift)) return false;
    return true;
  }

  // Libera "count" giorni della persona FUORI dalla settimana indicata e
  // dentro il mese attivo, così che completare il blocco settimanale del
  // punto 8 resti a saldo zero sul tetto mensile del punto 7. Se non riesce a
  // liberarne abbastanza ripristina quelli già tolti e restituisce false.
  function freeMonthlyDaysOutsideWeek(person,count,weekStart,startKey,lockedCells){
    const weekKeys = new Set(weekDateKeys(weekStart));
    const nDays = daysInMonth(activeYear,activeMonth);
    const freed = [];
    for(let day=nDays;day>=1 && freed.length<count;day -= 1){
      const key = dateKey(new Date(activeYear,activeMonth,day));
      if(key < startKey || weekKeys.has(key) || lockedCells.has(cellKey(person.id,key))) continue;
      const shift = getShift(person.id,key);
      if(!isWorkShift(shift)) continue;
      if(!removalKeepsDailyRules(person,key) || !removalKeepsWeeklyMinimum(person,key)) continue;
      // Punto 6: mai togliere un giorno interno a un blocco (lo spezzerebbe).
      if(removalSplitsSameShiftBlock(person.id,key)) continue;
      setShiftValue(person.id,key,'');
      freed.push({key,shift});
    }
    if(freed.length === count) return true;
    freed.forEach(entry => setShiftValue(person.id,entry.key,entry.shift));
    return false;
  }

  function completeWeeklyConsecutiveBlocks(startKey,lockedCells){
    // Questo passaggio esiste solo per FAR RISPETTARE il blocco settimanale
    // minimo. È esattamente la regola che "Migliora pianificazione" mette in
    // deroga, quindi durante quella passata non deve girare (richiesta PM
    // 2026-08-07).
    if(improvePlanRun) return 0;
    const nDays = daysInMonth(activeYear,activeMonth);
    const checkedWeeks = new Set();
    for(let day=1;day<=nDays;day += 1){
      const key = dateKey(new Date(activeYear,activeMonth,day));
      if(key < startKey || !rulesApplyTo(key)) continue;
      const weekStart = weekStartFor(key);
      if(checkedWeeks.has(weekStart) || !fullWeekIsInsideActiveMonth(weekStart)) continue;
      checkedWeeks.add(weekStart);
      const keys = weekDateKeys(weekStart);

      state.staff.forEach(person => {
        // Degrandi è escluso dal blocco settimanale: la sua regola
        // individuale fissa (DEGRANDI_RULE_TEXT) determina già il turno di
        // ogni giorno.
        if(isDegrandi(person)) return;
        if(weekHasAnyWork(person.id,weekStart) && !hasInvalidSameShiftRun(person.id,weekStart)) return;
        const buildCandidates = ignoreMonthlyLimit => {
          const list = [];
          for(let start=0;start<=keys.length-activeRules().minSameShiftDays;start += 1){
            const windowKeys = keys.slice(start,start+activeRules().minSameShiftDays);
            for(const shift of ['M','P','N','GG']){
              let additions = 0;
              let allowed = true;
              for(const dKey of windowKeys){
                const current = getShift(person.id,dKey);
                if(current && current !== shift){ allowed = false; break; }
                if(!current){
                  if(dKey < startKey || lockedCells.has(cellKey(person.id,dKey)) || !postPassAssignmentAllowed(person,dKey,shift,ignoreMonthlyLimit)){
                    allowed = false;
                    break;
                  }
                  additions += 1;
                }
              }
              if(allowed) list.push({windowKeys,shift,additions});
            }
          }
          list.sort((a,b)=>a.additions-b.additions || a.windowKeys[0].localeCompare(b.windowKeys[0]));
          return list;
        };
        const applyBlock = block => block.windowKeys.forEach(dKey => {
          if(!getShift(person.id,dKey)) setShiftValue(person.id,dKey,block.shift);
        });

        const chosen = buildCandidates(false)[0];
        if(chosen){ applyBlock(chosen); return; }

        // Tetto mensile raggiunto: prima di rinunciare al blocco settimanale
        // si tenta di completarlo A SALDO ZERO, liberando in un'altra
        // settimana dello stesso mese tanti giorni quanti se ne aggiungono.
        // Si accetta solo se nessuna regola inderogabile peggiora e il totale
        // dei conflitti non sale; altrimenti si ripristina tutto. Senza questo
        // recupero il punto 7 hard faceva salire le settimane senza blocco da
        // 23 a 48 celle su ott-dic (misurato 2026-08-07).
        const relaxed = buildCandidates(true)[0];
        if(!relaxed) return;
        const toFree = relaxed.additions - (monthlyWorkingDayTarget(activeYear,activeMonth) - monthlyPlannedCount(person));
        if(toFree <= 0) return;
        const activeKey = monthKey(activeYear,activeMonth);
        const snapshot = cloneData(state.schedules[activeKey] || {});
        const baseline = validateSchedule();
        if(freeMonthlyDaysOutsideWeek(person,toFree,weekStart,startKey,lockedCells)){
          applyBlock(relaxed);
          const trial = validateSchedule();
          if(noHardRuleGotWorse(conflictCountsByCode(baseline),conflictCountsByCode(trial))
             && trial.month.length <= baseline.month.length) return;
        }
        state.schedules[activeKey] = snapshot;
      });
    }
  }

  // allowBelowTarget serve SOLO quando un altro turno dello stesso giorno è a
  // ZERO: in quel caso il turno di partenza può scendere sotto il proprio
  // minimo, ma MAI sotto una persona. Un turno sotto minimo resta un conflitto
  // visibile e riparabile; un turno senza nessuno in servizio no (richiesta PM
  // 2026-08-07: "ogni turno di ogni giorno deve avere almeno 1 persona").
  function removalKeepsDailyRules(person,dKey,allowBelowTarget=false){
    const shift = getShift(person.id,dKey);
    if(!isWorkShift(shift)) return false;
    const info = getDayInfo(parseDateKey(dKey));
    const {counts,coverage} = getCountsForDate(dKey);
    const targets = targetsFor(info);
    const floors = allowBelowTarget
      ? {M:Math.min(targets.M,1),P:Math.min(targets.P,1),N:Math.min(targets.N,1)}
      : targets;
    const nextCoverage = {...coverage};
    if(shift === 'M') nextCoverage.M -= 1;
    else if(shift === 'P') nextCoverage.P -= 1;
    else if(shift === 'N') nextCoverage.N -= 1;
    if(nextCoverage.M < floors.M || nextCoverage.P < floors.P || nextCoverage.N < floors.N) return false;

    const silvio = findSpecialPerson('silvio-morello','SILVIO MORELLO');
    if(requiresCompanion(info) && silvio && person.id !== silvio.id && getShift(silvio.id,dKey) === shift && counts[shift] <= 2) return false;
    return true;
  }

  // Punto 6: togliere un giorno in MEZZO a un blocco lo spezza in due blocchi
  // dello stesso turno, e due blocchi uguali di fila sono esattamente ciò che
  // il punto 6 vieta ("non deve essere gli stessi turni"). È il modo in cui la
  // rotazione si rompe mentre si applica il punto 7, che invece i giorni deve
  // toglierli (misurato 2026-08-07: violazioni del tipo P->P e N->N).
  // Togliere un giorno di bordo lascia il blocco contiguo e la sequenza
  // intatta.
  function removalSplitsSameShiftBlock(personId,dKey){
    const shift = getShift(personId,dKey);
    if(!SHIFT_ROTATION_ORDER.includes(shift)) return false;
    const d = parseDateKey(dKey);
    return getShift(personId,dateKey(addDays(d,-1))) === shift
        && getShift(personId,dateKey(addDays(d,1))) === shift;
  }

  function removalKeepsWeeklyMinimum(person,dKey){
    const weekStart = weekStartFor(dKey);
    if(!rulesApplyTo(dKey) || !fullWeekIsInsideActiveMonth(weekStart)) return true;
    // Degrandi resta fuori dal blocco settimanale generico: la sua regola
    // individuale fissa (DEGRANDI_RULE_TEXT) non impone alcun blocco minimo.
    if(isDegrandi(person)) return true;
    if(!weekHasAnyWork(person.id,weekStart)) return true;
    return allSameShiftRunsMeetMinimum(person.id,weekStart,{[dKey]:''});
  }

  function monthlyPlannedCountIn(person,year,month){
    let planned = 0;
    const nDays = daysInMonth(year,month);
    for(let day=1;day<=nDays;day += 1){
      const key = dateKey(new Date(year,month,day));
      if(isMonthlyPlannedStatus(getShift(person.id,key),key)) planned += 1;
    }
    return planned;
  }

  function monthlyPlannedCount(person){
    return monthlyPlannedCountIn(person,activeYear,activeMonth);
  }

  // Punto 7 di "regola globale": il totale del mese non può superare i giorni
  // lavorativi (lun-ven esclusi festivi). Va valutato con la cella di dKey
  // ancora vuota: i passaggi a giorni invariati (relocation, cambio di turno)
  // svuotano la cella di partenza prima di chiedere il permesso, quindi non
  // vengono bloccati da questo controllo.
  //
  // Il tetto si misura sul mese a cui appartiene la CELLA, non sul mese
  // attivo. runAutomaticPlanning pianifica un mese alla volta, ma
  // fullWeekIsInsideActiveMonth ammette di proposito la settimana a cavallo
  // con il mese precedente, quindi le riparazioni settimanali di novembre
  // scrivono anche negli ultimi giorni di ottobre. Legando il controllo al
  // mese attivo, quelle scritture sfuggivano completamente al tetto: ottobre
  // usciva pulito dal proprio passaggio e tornava a 24-25 giorni dopo quello
  // di novembre (misurato 2026-08-07: 9 celle di ottobre riscritte da
  // novembre, CIPOLLA 22->24 e PERETTO 22->25).
  function exceedsMonthlyLimit(person,dKey,shift){
    const d = parseDateKey(dKey);
    if(!isMonthlyPlannedStatus(shift,dKey)) return false;
    return monthlyPlannedCountIn(person,d.getFullYear(),d.getMonth()) >= monthlyWorkingDayTarget(d.getFullYear(),d.getMonth());
  }

  function removeDirectMonthlySurplus(person,startKey,lockedCells,monthlyLimit){
    let planned = monthlyPlannedCount(person);
    const nDays = daysInMonth(activeYear,activeMonth);
    const buildCandidates = relaxWeeklyBlock => {
      const list = [];
      for(let day=nDays;day>=1;day -= 1){
        const key = dateKey(new Date(activeYear,activeMonth,day));
        if(key < startKey || lockedCells.has(cellKey(person.id,key))) continue;
        if(!isWorkShift(getShift(person.id,key))) continue;
        if(!removalKeepsDailyRules(person,key)) continue;
        if(!relaxWeeklyBlock && !removalKeepsWeeklyMinimum(person,key)) continue;
        const d = parseDateKey(key);
        list.push({
          key,
          weekday:d.getDay() >= 1 && d.getDay() <= 5,
          // Punto 6: i giorni interni a un blocco vanno tolti solo se non
          // resta altro, perché spezzano il blocco in due tronconi dello
          // stesso turno.
          splits:removalSplitsSameShiftBlock(person.id,key)
        });
      }
      list.sort((a,b) => Number(a.splits)-Number(b.splits)
        || Number(b.weekday)-Number(a.weekday)
        || b.key.localeCompare(a.key));
      return list;
    };
    while(planned > monthlyLimit){
      // Il tetto mensile (monthlyLimit) prevale sulla preferenza per i blocchi
      // settimanali dello stesso turno: se nessun giorno è rimovibile
      // rispettando anche removalKeepsWeeklyMinimum, si prova comunque a
      // rimuovere rilassando solo quel vincolo. removalKeepsDailyRules (minimi
      // di copertura giornaliera e compagno di Silvio) resta inderogabile.
      let chosen = buildCandidates(false)[0];
      if(!chosen) chosen = buildCandidates(true)[0];
      if(!chosen){
        console.warn(`Limite mensile non rispettabile per ${person.name}: restano ${planned} giorni pianificati (limite ${monthlyLimit}) e nessun giorno è rimovibile senza violare la copertura minima giornaliera.`);
        break;
      }
      setShiftValue(person.id,chosen.key,'');
      planned -= 1;
    }
    return planned;
  }

  function transferEssentialSurplus(person,startKey,lockedCells,monthlyLimit){
    if(monthlyPlannedCount(person) <= monthlyLimit) return false;
    const nDays = daysInMonth(activeYear,activeMonth);
    for(let day=nDays;day>=1;day -= 1){
      const key = dateKey(new Date(activeYear,activeMonth,day));
      const shift = getShift(person.id,key);
      if(key < startKey || lockedCells.has(cellKey(person.id,key)) || !isWorkShift(shift)) continue;
      if(!removalKeepsDailyRules(person,key)) continue;
      if(!removalKeepsWeeklyMinimum(person,key)) continue;
      // Punto 6: un giorno interno al blocco lo spezzerebbe in due tronconi
      // dello stesso turno.
      if(removalSplitsSameShiftBlock(person.id,key)) continue;

      const replacement = state.staff.find(other =>
        other.id !== person.id &&
        !getShift(other.id,key) &&
        !lockedCells.has(cellKey(other.id,key)) &&
        postPassAssignmentAllowed(other,key,shift)
      );
      if(!replacement) continue;

      setShiftValue(replacement.id,key,shift);
      setShiftValue(person.id,key,'');
      return true;
    }
    return false;
  }

  // Scambio a tre per liberare un giorno oltre il tetto mensile quando né
  // removeDirectMonthlySurplus né transferEssentialSurplus ci riescono
  // (bug segnalato dalla PM 2026-08-07).
  //
  // Situazione misurata su ottobre 2026: tutti e 24 i giorni di GREGORIO
  // CIGNETTI avevano removalKeepsDailyRules = false, perché si trovava sempre
  // sul turno al minimo o sotto il minimo (N 1/2, P 2/3, M 3/3), mentre il
  // surplus dello stesso giorno stava su un ALTRO turno e in mano ad ALTRE
  // persone (M 6/3, M 7/3). removeDirectMonthlySurplus guarda solo i giorni
  // della persona in eccesso, e transferEssentialSurplus cerca un collega
  // completamente libero quel giorno: nei giorni critici i liberi erano 0.
  // Mancava proprio la mossa "sposto un collega dal turno in surplus al turno
  // scoperto, così il giorno della persona in eccesso diventa rimovibile".
  //
  // Ogni spostamento passa da canReplaceWorkShift, quindi copertura minima,
  // blocco settimanale, rotazione, riposo dopo notte e compagno di Silvio
  // restano verificati; il risultato viene accettato solo se il totale dei
  // conflitti non peggiora.
  // Conteggio dei conflitti per codice: serve a impedire che una riparazione
  // "migliori il totale" barattando una violazione con una di un'altra
  // regola. Nessuno scambio è accettabile se fa comparire un codice che prima
  // non c'era o se ne aumenta uno esistente.
  function conflictCountsByCode(validationResult){
    const counts = {};
    validationResult.month.forEach(item => { counts[item.code] = (counts[item.code]||0)+1; });
    return counts;
  }

  function noRuleGotWorse(baselineCounts,trialCounts){
    return Object.keys(trialCounts).every(code => (trialCounts[code]||0) <= (baselineCounts[code]||0));
  }

  // Regole che una riparazione non può MAI peggiorare, nemmeno quando il
  // totale dei conflitti scende: abilitazioni della persona, riposi di
  // sicurezza, vincoli di coppia/livello, il limite dei giorni consecutivi e
  // il tetto mensile del punto 7. Confrontare solo il TOTALE permetteva di
  // barattare due violazioni del blocco settimanale contro una violazione di
  // abilitazione (misurato 2026-08-07: SILVIO MORELLO in N il 25/12, giorno
  // festivo per cui non è abilitato). Le regole restanti (blocco settimanale,
  // equilibrio mensile, percentuali storiche) restano confrontabili sul
  // totale, come prima.
  const INVIOLABLE_CONFLICT_CODES = [
    'ABILITAZIONE_TURNO','ABILITAZIONE_WEEKEND','ABILITAZIONE_FEST',
    'RIPOSO_DOPO_NOTTI','RIPOSO_MINIMO_11H','P_DOPO_N_VIETATO',
    'GIORNI_CONSECUTIVI','LIVELLO_ALTO_STESSO_TURNO','COPPIA_STESSO_TURNO',
    'NON_DA_SOLO','GIORNI_MESE_NON_UGUALI',
    // Punto 4 e regole individuali: anche queste sono qualifiche, non
    // preferenze. Senza di esse una riparazione che scriveva direttamente
    // (senza passare da hardAssignmentAllowed) poteva piazzare GG in un
    // festivo pur di chiudere un blocco settimanale — misurato 2026-08-07:
    // COMINELLI e SILVIO in GG l'8 dicembre, che è festivo.
    'GG_SOLO_FERIALE','COMINELLI_SOLO_GG','DEGRANDI_TURNO_FISSO',
    'DEGRANDI_MAX_SABATI_M','DEGRANDI_RIPOSO_DOPO_5_GIORNI',
    'DEGRANDI_RIPOSO_SETTIMANA','MAX_FERIE_SETTIMANA',
    // Riposo obbligatorio dopo 5 GG consecutivi (richiesta PM 2026-08-07):
    // dichiarata inderogabile, quindi nessuna riparazione può peggiorarla.
    'RIPOSO_DOPO_5_GG'
  ];

  function noHardRuleGotWorse(baselineCounts,trialCounts){
    return INVIOLABLE_CONFLICT_CODES.every(code => (trialCounts[code]||0) <= (baselineCounts[code]||0));
  }

  // Punto 6: conta le transizioni di blocco che NON rispettano la sequenza
  // M -> N -> P (saltando i turni che la persona non può fare).
  //
  // validateSchedule non ha mai controllato la rotazione, quindi i passaggi
  // di riparazione che si confrontano solo sui conflitti potevano romperla
  // senza che nulla se ne accorgesse: rebalanceMonthlyShiftMix scambia interi
  // blocchi fra due persone e verifica l'inizio del blocco spostato, mai il
  // blocco SUCCESSIVO, che resta fuori sequenza (misurato 2026-08-07: 4
  // transizioni fuori ordine su 202 fra settembre e dicembre). Questo
  // contatore serve da guardia relativa: una riparazione è accettabile solo
  // se non ne aumenta il numero.
  function rotationOrderViolations(startKey){
    const nDays = daysInMonth(activeYear,activeMonth);
    let count = 0;
    state.staff.forEach(person => {
      const blocks = [];
      let current = '';
      for(let day=1;day<=nDays;day += 1){
        const key = dateKey(new Date(activeYear,activeMonth,day));
        const shift = getShift(person.id,key);
        if(!SHIFT_ROTATION_ORDER.includes(shift)){ current = ''; continue; }
        if(shift !== current){ blocks.push({shift,key}); current = shift; }
      }
      blocks.forEach((block,index) => {
        if(block.key < startKey) return;
        const previous = index === 0
          ? lastCompletedRotationShift(person.id,block.key)
          : blocks[index-1].shift;
        if(!previous) return;
        const expected = nextAllowedRotationShift(person,previous);
        if(expected && block.shift !== expected) count += 1;
      });
    });
    return count;
  }

  function freeDayByCrossShiftSwap(person,startKey,lockedCells,monthlyLimit){
    if(monthlyPlannedCount(person) <= monthlyLimit) return false;
    const nDays = daysInMonth(activeYear,activeMonth);
    const mKey = monthKey(activeYear,activeMonth);
    const baselineMonth = cloneData(state.schedules[mKey] || {});
    const baselineCounts = conflictCountsByCode(validateSchedule());

    for(let day=nDays;day>=1;day -= 1){
      const key = dateKey(new Date(activeYear,activeMonth,day));
      const shift = getShift(person.id,key);
      if(key < startKey || lockedCells.has(cellKey(person.id,key)) || !isWorkShift(shift)) continue;
      // I giorni già rimovibili sono competenza di removeDirectMonthlySurplus.
      if(removalKeepsDailyRules(person,key)) continue;
      const info = getDayInfo(parseDateKey(key));
      const targets = targetsFor(info);
      const coverage = getCountsForDate(key).coverage;
      const missing = (targets[shift]||0) - (coverage[shift]-1);
      // missing <= 0 significa che il giorno è bloccato da un altro vincolo
      // (compagno di Silvio), non dalla copertura: qui non c'è nulla da fare.
      if(missing <= 0) continue;

      state.schedules[mKey] = cloneData(baselineMonth);
      let moved = 0;
      for(let attempt=0;attempt<missing;attempt += 1){
        const live = getCountsForDate(key).coverage;
        const donor = state.staff.find(other => {
          if(other.id === person.id) return false;
          const otherShift = getShift(other.id,key);
          if(!isWorkShift(otherShift) || otherShift === shift) return false;
          const surplus = otherShift === 'GG'
            ? Math.min(live.M-targets.M,live.P-targets.P)
            : live[otherShift]-(targets[otherShift]||0);
          if(surplus <= 0) return false;
          return canReplaceWorkShift(other,key,shift,lockedCells);
        });
        if(!donor) break;
        setShiftValue(donor.id,key,shift);
        moved += 1;
      }
      if(moved === missing && removalKeepsDailyRules(person,key)){
        setShiftValue(person.id,key,'');
        // Il giorno tolto fa scendere di 1 GIORNI_MESE_NON_UGUALI, quindi lo
        // scambio è utile solo se NESSUN'ALTRA regola peggiora.
        if(noRuleGotWorse(baselineCounts,conflictCountsByCode(validateSchedule()))) return true;
      }
      state.schedules[mKey] = cloneData(baselineMonth);
    }
    state.schedules[mKey] = baselineMonth;
    return false;
  }

  // Il limite inferiore mensile è inderogabile dal 01/09/2026. Il vecchio
  // recupero aggiungeva una cella per volta: un passaggio successivo poteva
  // cancellare quel frammento perché non raggiungeva i 3 giorni minimi. Qui si
  // costruisce invece una finestra completa del blocco minimo, accettando solo
  // una prova che non peggiora nessuna regola hard. Una cella automatica di un
  // collega può essere ceduta soltanto se il collega resta sopra il suo floor;
  // le celle manuali e tutte le assenze rimangono intoccabili.
  function addMonthlyWorkBlock(person,startKey,lockedCells,floor,monthlyLimit){
    const nDays = daysInMonth(activeYear,activeMonth);
    const minimum = activeRules().minSameShiftDays;
    const mKey = monthKey(activeYear,activeMonth);
    const baselineMonth = cloneData(state.schedules[mKey] || {});
    const before = monthlyPlannedCount(person);
    let baselineHardCounts = null;
    let baselineRotation = null;

    const loadBaselineEvidence = () => {
      if(baselineHardCounts) return;
      state.schedules[mKey] = baselineMonth;
      baselineHardCounts = conflictCountsByCode(validateSchedule());
      baselineRotation = rotationOrderViolations(startKey);
    };

    for(let firstDay=1;firstDay<=nDays-minimum+1;firstDay += 1){
      const keys = Array.from({length:minimum},(_,offset) => dateKey(new Date(activeYear,activeMonth,firstDay+offset)));
      for(const shift of WORK_SHIFTS){
        // Filtro economico: i candidati che non possono già formare un blocco
        // completo non devono clonare né validare l'intero mese.
        state.schedules[mKey] = baselineMonth;
        let cheapAdditions = 0;
        let cheapAllowed = true;
        for(const key of keys){
          const current = getShift(person.id,key);
          if(current === shift) continue;
          if(current || key < startKey || lockedCells.has(cellKey(person.id,key)) || isManualCell(person.id,key)){
            cheapAllowed = false;
            break;
          }
          if(!postPassAssignmentAllowed(person,key,shift,false,false)){
            const occupant = state.staff.find(other => other.id !== person.id && getShift(other.id,key) === shift);
            const occupiedCell = occupant && cellKey(occupant.id,key);
            if(!occupant || lockedCells.has(occupiedCell) || isManualCell(occupant.id,key) ||
               monthlyPlannedCount(occupant) <= floor || removalSplitsSameShiftBlock(occupant.id,key)){
              cheapAllowed = false;
              break;
            }
          }
          cheapAdditions += 1;
        }
        if(!cheapAllowed || !cheapAdditions || before + cheapAdditions > monthlyLimit) continue;

        loadBaselineEvidence();
        state.schedules[mKey] = cloneData(baselineMonth);
        let additions = 0;
        let allowed = true;
        for(const key of keys){
          const current = getShift(person.id,key);
          if(current === shift) continue;
          if(current || key < startKey || lockedCells.has(cellKey(person.id,key)) || isManualCell(person.id,key)){
            allowed = false;
            break;
          }
          // Prima si aggiunge senza spostare nessuno. Solo se una coppia o il
          // livello ALTO lo vieta, si può cedere una stessa cella automatica
          // di un collega che resta comunque sopra il proprio floor.
          if(!postPassAssignmentAllowed(person,key,shift,false,false)){
            const occupant = state.staff.find(other => other.id !== person.id && getShift(other.id,key) === shift);
            const occupiedCell = occupant && cellKey(occupant.id,key);
            if(!occupant || lockedCells.has(occupiedCell) || isManualCell(occupant.id,key) ||
               monthlyPlannedCount(occupant) <= floor || removalSplitsSameShiftBlock(occupant.id,key)){
              allowed = false;
              break;
            }
            setShiftValue(occupant.id,key,'');
            if(!postPassAssignmentAllowed(person,key,shift,false,false)){
              allowed = false;
              break;
            }
          }
          setShiftValue(person.id,key,shift);
          additions += 1;
        }
        const trial = validateSchedule();
        const valid = allowed && additions > 0 && before + additions <= monthlyLimit &&
          monthlyPlannedCount(person) > before &&
          noHardRuleGotWorse(baselineHardCounts,conflictCountsByCode(trial)) &&
          rotationOrderViolations(startKey) <= baselineRotation &&
          !trial.month.some(item => item.staffId === person.id && item.code === 'STESSO_TURNO_CONSECUTIVO_MINIMO' && keys.includes(item.date));
        if(valid) return true;
      }
    }
    state.schedules[mKey] = baselineMonth;
    return false;
  }

  // Completamento fine del totale mensile quando addMonthlyWorkBlock non riesce
  // ad aggiungere un blocco intero: o perché il residuo è < minSameShiftDays, o
  // perché non esiste una finestra di giorni liberi consecutivi validi. Qui si
  // ALLUNGA di un giorno un blocco M/P/N/GG già esistente della persona, su un
  // giorno libero adiacente. Non si crea mai un blocco nuovo: il giorno si
  // salda a un blocco che è già ≥ minimo, quindi il punto 6 (blocco minimo) non
  // può essere violato. Il massimo del blocco resta garantito da
  // postPassAssignmentAllowed (MAX_CONSECUTIVE_WORK_DAYS = 5, il 6° solo per un
  // turno scoperto, mai per il solo conteggio mensile). Serve alle persone
  // molto vincolate (es. GRASSIS MARCO: solo M/P feriali + sabato M) che
  // altrimenti restano sotto il loro massimo raggiungibile pur avendo ancora
  // giorni idonei liberi. Ogni aggiunta passa dalle stesse verifiche di
  // non-regressione di addMonthlyWorkBlock: nessuna regola hard può peggiorare,
  // la rotazione non può aumentare, il tetto mensile non può essere superato.
  function extendMonthlyBlock(person,startKey,lockedCells,monthlyLimit){
    const nDays = daysInMonth(activeYear,activeMonth);
    const mKey = monthKey(activeYear,activeMonth);
    if(monthlyPlannedCount(person) >= monthlyLimit) return false;
    const baselineMonth = cloneData(state.schedules[mKey] || {});
    const baselineHardCounts = conflictCountsByCode(validateSchedule());
    const baselineRotation = rotationOrderViolations(startKey);

    for(let day=1;day<=nDays;day += 1){
      const key = dateKey(new Date(activeYear,activeMonth,day));
      if(key < startKey) continue;
      if(getShift(person.id,key)) continue;
      if(lockedCells.has(cellKey(person.id,key)) || isManualCell(person.id,key)) continue;
      // Turni candidati: quello di un giorno adiacente già lavorato dalla stessa
      // persona, così il nuovo giorno si unisce a un blocco esistente (lo
      // allunga) invece di formarne uno isolato più corto del minimo.
      const prevShift = getShift(person.id,dateKey(addDays(parseDateKey(key),-1)));
      const nextShift = getShift(person.id,dateKey(addDays(parseDateKey(key),1)));
      const candidates = [];
      [prevShift,nextShift].forEach(s => { if(isWorkShift(s) && !candidates.includes(s)) candidates.push(s); });
      for(const shift of candidates){
        if(!postPassAssignmentAllowed(person,key,shift,false,false)) continue;
        setShiftValue(person.id,key,shift);
        const trial = validateSchedule();
        const valid = monthlyPlannedCount(person) <= monthlyLimit &&
          noHardRuleGotWorse(baselineHardCounts,conflictCountsByCode(trial)) &&
          rotationOrderViolations(startKey) <= baselineRotation &&
          !trial.month.some(item => item.staffId === person.id && item.code === 'STESSO_TURNO_CONSECUTIVO_MINIMO' && item.date === key);
        if(valid) return true;
        setShiftValue(person.id,key,'');
      }
    }
    state.schedules[mKey] = baselineMonth;
    return false;
  }

  function topUpMonthlyShortfall(person,startKey,lockedCells,targetDays){
    const floor = Math.max(0,targetDays);
    const monthlyLimit = monthlyWorkingDayTarget(activeYear,activeMonth);
    let added = false;
    let guard = 0;
    while(monthlyPlannedCount(person) < floor && guard < daysInMonth(activeYear,activeMonth)){
      // Prima si tenta un blocco intero (comportamento storico). Se non è
      // possibile, si prova ad allungare un blocco già esistente: è l'unica via
      // per gli ultimi 1-2 giorni di chi non ha spazio per una finestra nuova
      // di giorni consecutivi (bug segnalato dalla PM: GRASSIS MARCO restava a
      // 17 invece del suo massimo raggiungibile da ottobre in poi).
      if(addMonthlyWorkBlock(person,startKey,lockedCells,floor,monthlyLimit)){
        added = true; guard += 1; continue;
      }
      if(extendMonthlyBlock(person,startKey,lockedCells,monthlyLimit)){
        added = true; guard += 1; continue;
      }
      break;
    }
    return added;
  }

  function rebalanceMonthlyTotals(startKey,lockedCells,monthlyLimit){
    state.staff.forEach(person => removeDirectMonthlySurplus(person,startKey,lockedCells,monthlyLimit));

    for(let pass=0;pass<4;pass += 1){
      let transferred = false;
      state.staff.forEach(person => {
        if(monthlyPlannedCount(person) <= monthlyLimit) return;
        if(transferEssentialSurplus(person,startKey,lockedCells,monthlyLimit)){
          transferred = true;
          return;
        }
        // Nessun collega libero quel giorno: si tenta lo scambio a tre.
        let guard = 0;
        while(monthlyPlannedCount(person) > monthlyLimit && guard < daysInMonth(activeYear,activeMonth)
              && freeDayByCrossShiftSwap(person,startKey,lockedCells,monthlyLimit)){
          transferred = true;
          guard += 1;
        }
      });
      state.staff.forEach(person => removeDirectMonthlySurplus(person,startKey,lockedCells,monthlyLimit));
      if(!transferred) break;
    }

    // Limite inferiore del punto 7, dopo che i totali in eccesso sono rientrati.
    const floor = Math.max(0, monthlyLimit - activeRules().waivedWorkDays);
    state.staff.forEach(person => topUpMonthlyShortfall(person,startKey,lockedCells,floor));
    // Rotazione dei giorni rinunciati (richiesta PM 2026-08-07): i giorni in
    // meno non devono ricadere sempre sulle stesse persone. Chi ha già
    // accumulato mesi corti nei mesi precedenti viene portato per primo al
    // limite pieno, così il giorno rinunciato di questo mese resta a chi non
    // l'ha ancora avuto. È l'unico punto in cui il mese attivo guarda i mesi
    // passati, e solo per ordinare le persone: nessun parametro viene
    // ereditato da un altro mese.
    if(floor < monthlyLimit){
      [...state.staff]
        .sort((a,b) => waivedDaysDebt(b) - waivedDaysDebt(a))
        .forEach(person => topUpMonthlyShortfall(person,startKey,lockedCells,monthlyLimit));
    }
  }

  // Somma, sui mesi già pianificati e precedenti a quello attivo, dei giorni
  // in cui la persona è rimasta sotto il limite mensile di quel mese.
  function waivedDaysDebt(person){
    const activeKey = monthKey(activeYear,activeMonth);
    let debt = 0;
    Object.keys(state.schedules || {}).forEach(key => {
      if(key >= activeKey || key < RULES_EFFECTIVE_FROM.slice(0,7)) return;
      const [year,month] = key.split('-').map(Number);
      if(!Number.isFinite(year) || !Number.isFinite(month)) return;
      const limit = monthlyWorkingDayTarget(year,month-1);
      debt += Math.max(0, limit - monthlyPlannedCountIn(person,year,month-1));
    });
    return debt;
  }

  function changeKeepsWeeklyMinimum(person,dKey,newShift){
    const weekStart = weekStartFor(dKey);
    if(!rulesApplyTo(dKey) || !fullWeekIsInsideActiveMonth(weekStart)) return true;
    // Degrandi non è vincolato al blocco settimanale: la sua regola
    // individuale fissa (DEGRANDI_RULE_TEXT) determina già da sola il turno di
    // ogni giorno, quindi un cambio non va mai rifiutato per questo motivo.
    if(isDegrandi(person)) return true;
    return allSameShiftRunsMeetMinimum(person.id,weekStart,{[dKey]:newShift});
  }

  function canReplaceWorkShift(person,dKey,newShift,lockedCells,emergency){
    const oldShift = getShift(person.id,dKey);
    if(!isWorkShift(oldShift) || oldShift === newShift) return false;
    if(lockedCells.has(cellKey(person.id,dKey))) return false;
    // In emergenza (turno di destinazione a ZERO) il turno di partenza può
    // restare sotto il proprio minimo purché non si svuoti: vedi
    // removalKeepsDailyRules.
    if(!removalKeepsDailyRules(person,dKey,emergency)) return false;

    setShiftValue(person.id,dKey,'');
    const allowed = postPassAssignmentAllowed(person,dKey,newShift,false,emergency);
    setShiftValue(person.id,dKey,oldShift);
    if(!allowed) return false;
    // In emergenza (turno a zero) cede anche il blocco settimanale del punto
    // 8: una giornata senza nessuno sul turno è più grave di una settimana
    // con il blocco spezzato.
    return emergency || changeKeepsWeeklyMinimum(person,dKey,newShift);
  }

  // Riporta le celle di Degrandi sulla sua regola individuale fissa
  // (DEGRANDI_RULE_TEXT): i passaggi di riparazione scrivono anche senza
  // passare da hardAssignmentAllowed, quindi la normalizzazione chiude il
  // ciclo. Qualsiasi turno di lavoro diverso da quello previsto viene
  // riscritto o svuotato, e i sabati in M oltre il tetto mensile vengono
  // tolti a partire dall'ultimo.
  function normalizeDegrandiAssignments(startKey,lockedCells){
    const degrandi = findSpecialPerson('degrandi-roberto','DEGRANDI');
    if(!degrandi) return 0;
    let changed = 0;
    const nDays = daysInMonth(activeYear,activeMonth);
    const saturdayMKeys = [];
    for(let day=1;day<=nDays;day += 1){
      const d = new Date(activeYear,activeMonth,day);
      const dKey = dateKey(d);
      // Le regole fisse guidano soltanto le celle automatiche. Una scelta
      // manuale o un'assenza bloccata resta un dato del PM: il conflitto viene
      // mostrato dalla validazione, ma non viene mai rilasciato né riscritto.
      if(dKey < startKey || !rulesApplyTo(dKey) ||
         lockedCells.has(cellKey(degrandi.id,dKey)) || isManualCell(degrandi.id,dKey)) continue;
      const current = getShift(degrandi.id,dKey);
      if(!isWorkShift(current)) continue;
      const required = degrandiRequiredShift(d,getDayInfo(d));
      if(current !== required){
        if(required && canReplaceWorkShift(degrandi,dKey,required,lockedCells)){
          setShiftValue(degrandi.id,dKey,required);
        }else{
          setShiftValue(degrandi.id,dKey,'');
        }
        changed += 1;
      }
      if(d.getDay() === 6 && getShift(degrandi.id,dKey) === 'M') saturdayMKeys.push(dKey);
    }
    saturdayMKeys.slice(DEGRANDI_MAX_SATURDAY_M).forEach(dKey => {
      if(lockedCells.has(cellKey(degrandi.id,dKey)) || isManualCell(degrandi.id,dKey)) return;
      setShiftValue(degrandi.id,dKey,'');
      changed += 1;
    });
    return changed;
  }

  function findRelocationForCoverage(targetKey,targetShift,startKey,lockedCells,emergency){
    const targetDate = parseDateKey(targetKey);
    const targetWeek = weekStartFor(targetKey);
    const nDays = daysInMonth(activeYear,activeMonth);
    const options = [];

    state.staff.forEach(person => {
      if(getShift(person.id,targetKey)) return;
      if(lockedCells.has(cellKey(person.id,targetKey))) return;
      const assigned = assignedPeopleForDate(targetKey);
      const silvio = findSpecialPerson('silvio-morello','SILVIO MORELLO');
      if(requiresCompanion(getDayInfo(targetDate)) && silvio && person.id === silvio.id && assigned[targetShift].length === 0) return;

      for(let day=1;day<=nDays;day += 1){
        const sourceKey = dateKey(new Date(activeYear,activeMonth,day));
        if(sourceKey === targetKey || sourceKey < startKey) continue;
        if(lockedCells.has(cellKey(person.id,sourceKey))) continue;
        const sourceShift = getShift(person.id,sourceKey);
        if(!isWorkShift(sourceShift)) continue;
        if(!removalKeepsDailyRules(person,sourceKey)) continue;
        if(!emergency && !removalKeepsWeeklyMinimum(person,sourceKey)) continue;
        // Punto 6: un giorno interno al blocco lo spezzerebbe in due tronconi
        // dello stesso turno. In emergenza (turno a zero) cede anche questo:
        // senza la deroga restavano esclusi tutti i giorni sorgente e la
        // giornata scoperta non si riusciva più a coprire.
        if(!emergency && removalSplitsSameShiftBlock(person.id,sourceKey)) continue;

        setShiftValue(person.id,sourceKey,'');
        const targetAllowed = postPassAssignmentAllowed(person,targetKey,targetShift,false,emergency);
        const targetWeeklyOk = emergency || !rulesApplyTo(targetKey) || !fullWeekIsInsideActiveMonth(targetWeek) ||
          allSameShiftRunsMeetMinimum(person.id,targetWeek,{[targetKey]:targetShift});
        setShiftValue(person.id,sourceKey,sourceShift);
        if(!targetAllowed || !targetWeeklyOk) continue;

        const sourceInfo = getDayInfo(parseDateKey(sourceKey));
        const sourceCounts = getCountsForDate(sourceKey);
        const sourceTargets = targetsFor(sourceInfo);
        const surplus = sourceShift === 'GG'
          ? Math.min(sourceCounts.coverage.M-sourceTargets.M,sourceCounts.coverage.P-sourceTargets.P)
          : sourceCounts.coverage[sourceShift]-sourceTargets[sourceShift];
        const before = getShift(person.id,dateKey(addDays(targetDate,-1)));
        const after = getShift(person.id,dateKey(addDays(targetDate,1)));
        const continuity = Number(before === targetShift) + Number(after === targetShift);
        options.push({person,sourceKey,sourceShift,surplus,continuity});
      }
    });

    options.sort((a,b) => b.continuity-a.continuity || b.surplus-a.surplus || a.sourceKey.localeCompare(b.sourceKey));
    return options[0] || null;
  }

  // ULTIMISSIMA risorsa per un turno a ZERO. Si arriva qui solo quando sono
  // già fallite tutte le strade precedenti: scambio di turno con una persona
  // in surplus, spostamento di un giorno da un'altra data, assegnazione di una
  // persona libera anche oltre il tetto mensile. Il 13/09/2026 restava così il
  // turno P deserto: tutte le persone libere erano bloccate da regole
  // inderogabili (riposo di 11 ore, recupero dopo le notti) e gli altri turni
  // dello stesso giorno erano esattamente al loro minimo, quindi nessuno era
  // cedibile.
  //
  // Regola della PM (2026-08-07): ogni turno di ogni giorno deve avere ALMENO
  // 1 persona, il minimo non può mai essere 0. Qui si prende quindi una
  // persona da un ALTRO turno dello stesso giorno, purché quel turno resti
  // comunque con almeno 1 persona (GG non ha minimo di copertura e può essere
  // svuotato). Il giorno lavorato non cambia, quindi il tetto mensile del
  // punto 7 non viene toccato: cambia solo il turno. Il turno donatore può
  // scendere sotto il proprio minimo e resta segnalato in rosso come MIN_x,
  // che è comunque meno grave di un turno senza nessuno in servizio.
  function donorForEmptyShift(dKey,neededShift,lockedCells){
    const info = getDayInfo(parseDateKey(dKey));
    const {coverage} = getCountsForDate(dKey);
    const assigned = assignedPeopleForDate(dKey);
    const options = [];
    state.staff.forEach(person => {
      const oldShift = getShift(person.id,dKey);
      if(!isWorkShift(oldShift) || oldShift === neededShift) return;
      if(lockedCells.has(cellKey(person.id,dKey))) return;
      // Il turno di partenza non può a sua volta finire a zero.
      if(oldShift !== 'GG' && coverage[oldShift] <= 1) return;
      // Le abilitazioni personali (turno, weekend, festivo) restano vincolanti:
      // coprire un turno con chi non è abilitato non è una copertura.
      if(!hardAssignmentAllowed(person,info,neededShift)) return;
      if(specialPairConflict(person.id,neededShift,assigned)) return;
      options.push({person,donorCount:oldShift === 'GG' ? Infinity : coverage[oldShift]});
    });
    options.sort((a,b) => b.donorCount-a.donorCount || state.staff.indexOf(a.person)-state.staff.indexOf(b.person));
    return options[0]?.person || null;
  }

  function repairDailyCoverageBySwitching(startKey,lockedCells){
    let changed = 0;
    const nDays = daysInMonth(activeYear,activeMonth);
    for(let pass=0;pass<6;pass += 1){
      let passChanged = false;
      for(let day=1;day<=nDays;day += 1){
        const d = new Date(activeYear,activeMonth,day);
        const dKey = dateKey(d);
        if(dKey < startKey) continue;
        const info = getDayInfo(d);
        const targets = targetsFor(info);

        for(const neededShift of ['N','P','M']){
          let guard = 0;
          while(getCountsForDate(dKey).coverage[neededShift] < targets[neededShift] && guard < state.staff.length){
            guard += 1;
            const currentCounts = getCountsForDate(dKey);
            // Turno completamente scoperto: si applica la deroga del punto 9.
            // Il cambio di turno è a parità di giorni, quindi il tetto mensile
            // del punto 7 non viene toccato.
            const emergency = currentCounts.coverage[neededShift] === 0;
            const candidates = state.staff
              .filter(person => canReplaceWorkShift(person,dKey,neededShift,lockedCells,emergency))
              .map(person => {
                const oldShift = getShift(person.id,dKey);
                const surplus = oldShift === 'GG'
                  ? Math.min(currentCounts.coverage.M-targets.M,currentCounts.coverage.P-targets.P)
                  : currentCounts.coverage[oldShift]-targets[oldShift];
                const before = getShift(person.id,dateKey(addDays(d,-1)));
                const after = getShift(person.id,dateKey(addDays(d,1)));
                const continuity = Number(before === neededShift) + Number(after === neededShift);
                return {person,surplus,continuity};
              })
              // Fuori emergenza si sposta solo chi è in eccedenza. Con il turno
              // a ZERO si accetta anche un donatore senza eccedenza: il suo
              // turno resta comunque con almeno 1 persona (garantito da
              // removalKeepsDailyRules) e i passaggi successivi lo riportano al
              // minimo. Chi ha eccedenza resta comunque preferito dal sort.
              .filter(item => emergency || item.surplus > 0)
              .sort((a,b) => b.continuity-a.continuity || b.surplus-a.surplus || state.staff.indexOf(a.person)-state.staff.indexOf(b.person));

            const chosen = candidates[0]?.person;
            if(chosen){
              setShiftValue(chosen.id,dKey,neededShift);
              changed += 1;
              passChanged = true;
              continue;
            }

            const relocation = findRelocationForCoverage(dKey,neededShift,startKey,lockedCells,emergency);
            if(!relocation) break;
            setShiftValue(relocation.person.id,relocation.sourceKey,'');
            setShiftValue(relocation.person.id,dKey,neededShift);
            changed += 2;
            passChanged = true;
          }
        }
      }
      if(!passChanged) break;
    }
    return changed;
  }

  // GARANZIA FINALE: nessun turno di nessun giorno può restare senza nessuno.
  // Gira DOPO ogni altra riparazione, quindi qui tutte le soluzioni che
  // rispettano l'intero regolamento sono già state tentate e scartate: se un
  // turno è ancora a zero vuol dire che non ne esiste nessuna. Fra un turno
  // vuoto e una regola di riposo/rotazione violata ma SEGNALATA in rosso, la
  // PM ha scelto la seconda (2026-08-07: "ogni turno di ogni giorno deve avere
  // almeno 1 persona").
  //
  // Restano invece inderogabili i vincoli che non sono preferenze di
  // pianificazione ma dati di fatto: non viene mai assegnato chi è assente
  // (ferie, malattia, corso: la cella è già occupata), chi non è abilitato a
  // quel turno o a quel weekend/festivo, e nessuna cella manuale della PM
  // viene toccata. Se nessuno soddisfa queste condizioni il turno resta
  // scoperto e visibile come conflitto: non c'è nessuno da poterci mettere.
  // The no-zero floor preserves every hard rule. It may leave a short same-shift
  // run, and may extend a work run from five to no more than six days.
  function zeroFloorAssignmentAllowed(person,dKey,shift){
    if(getShift(person.id,dKey)) return false;
    const d = parseDateKey(dKey);
    const info = getDayInfo(d);
    if(!hardAssignmentAllowed(person,info,shift)) return false;
    if(exceedsMonthlyLimit(person,dKey,shift)) return false;
    if(shift !== 'N' && isNightRecoveryDay(person.id,dKey)) return false;
    if(shift === 'N' && isNightRecoveryDay(person.id,dKey) && getShift(person.id,dateKey(addDays(d,-1))) !== 'N') return false;
    if(createsNightRecoveryConflict(person.id,dKey,shift)) return false;
    if(rulesApplyTo(dKey) && violatesRotationOrder(person,dKey,shift)) return false;
    const workBefore = countAdjacentDays(person.id,dKey,isWorkShift,-1);
    const workAfter = countAdjacentDays(person.id,dKey,isWorkShift,1);
    if(workBefore + 1 + workAfter > MAX_CONSECUTIVE_WORK_DAYS_SHORTAGE) return false;
    const sameBefore = countAdjacentDays(person.id,dKey,value => value === shift,-1);
    const sameAfter = countAdjacentDays(person.id,dKey,value => value === shift,1);
    if(sameBefore + 1 + sameAfter > MAX_SAME_SHIFT_DAYS) return false;
    const assigned = assignedPeopleForDate(dKey);
    if(specialPairConflict(person.id,shift,assigned)) return false;
    if(isHighLevel(person) && assignedHighCount(assigned[shift]) >= 1) return false;
    return true;
  }

  function enforceOnePersonPerShift(startKey,lockedCells){
    let changed = 0;
    const nDays = daysInMonth(activeYear,activeMonth);
    for(let day=1;day<=nDays;day += 1){
      const d = new Date(activeYear,activeMonth,day);
      const dKey = dateKey(d);
      if(dKey < startKey || isHistoricalDate(dKey)) continue;
      const info = getDayInfo(d);
      for(const shift of ['M','P','N']){
        if(getCountsForDate(dKey).coverage[shift] > 0) continue;

        const chosen = state.staff
          .filter(person =>
            !lockedCells.has(cellKey(person.id,dKey)) &&
            zeroFloorAssignmentAllowed(person,dKey,shift)
          )
          .sort((a,b) => monthlyPlannedCount(a)-monthlyPlannedCount(b) ||
            state.staff.indexOf(a)-state.staff.indexOf(b))[0];
        if(!chosen) continue;

        setShiftValue(chosen.id,dKey,shift);
        changed += 1;
        console.warn(`Turno ${shift} del ${dKey} senza nessuno: assegnato ${chosen.name} in deroga solo alla rotazione; il conflitto resta segnalato.`);
      }
    }
    return changed;
  }

  function repairAutomaticRunInvariants(startKey,lockedCells){
    let repaired = 0;
    const checkedRuns = new Set();
    const nDays = daysInMonth(activeYear,activeMonth);
    const removable = (person,dKey) =>
      dKey >= startKey &&
      currentMonthContains(dKey) &&
      !isHistoricalDate(dKey) &&
      !lockedCells.has(cellKey(person.id,dKey)) &&
      !isManualCell(person.id,dKey) &&
      AUTO_SHIFT_CODES.includes(getShift(person.id,dKey));

    for(let day=1;day<=nDays;day += 1){
      const dKey = dateKey(new Date(activeYear,activeMonth,day));
      if(dKey < startKey || isHistoricalDate(dKey)) continue;
      state.staff.forEach(person => {
        const run = sameShiftRunAt(person.id,dKey);
        if(!run.keys.length) return;
        const signature = `${person.id}|${run.shift}|${run.keys[0]}|${run.keys[run.keys.length-1]}`;
        if(checkedRuns.has(signature)) return;
        checkedRuns.add(signature);
        const targets = run.keys.length > MAX_SAME_SHIFT_DAYS
          ? run.keys.slice(MAX_SAME_SHIFT_DAYS)
          : run.keys.length < activeRules().minSameShiftDays ? run.keys : [];
        targets.filter(key => removable(person,key)).forEach(key => {
          setShiftValue(person.id,key,'');
          repaired += 1;
        });
      });
    }
    return repaired;
  }

  function repairThreeDayWeeklyRuns(startKey,lockedCells){
    let repaired = 0;
    const nDays = daysInMonth(activeYear,activeMonth);
    const mKey = monthKey(activeYear,activeMonth);
    const checkedWeeks = new Set();

    for(let day=1;day<=nDays;day += 1){
      const key = dateKey(new Date(activeYear,activeMonth,day));
      if(key < startKey || !rulesApplyTo(key)) continue;
      const weekStart = weekStartFor(key);
      if(checkedWeeks.has(weekStart) || !fullWeekIsInsideActiveMonth(weekStart)) continue;
      checkedWeeks.add(weekStart);
      const weekKeys = weekDateKeys(weekStart);

      state.staff.forEach(person => {
        // Degrandi è escluso dal blocco settimanale (richiesta PM
        // 2026-08-06, T4): vedi validateSchedule e candidateAllowed.
        if(isDegrandi(person)) return;
        // Punto 8 di "regola globale": va completato QUALSIASI frammento
        // sotto i giorni consecutivi minimi richiesti (1, 2 o 3
        // giorni), non solo quelli esattamente a 3. Prima il filtro
        // accettava solo la lunghezza esatta MIN-1, quindi un turno spezzato
        // tipo 3 giorni + buco + 2 giorni restava consegnato così com'era,
        // perché il secondo frammento (2 giorni) non veniva mai considerato
        // (bug segnalato dalla PM 2026-08-06, T2).
        const runs = sameShiftRunsInWeek(person.id,weekStart).filter(run => run.keys.length < activeRules().minSameShiftDays);
        if(!runs.length) return;

        const baselineMonth = cloneData(state.schedules[mKey] || {});
        const baselineValidation = validateSchedule();
        const baselineConflicts = baselineValidation.month.length;
        const baselineHardCounts = conflictCountsByCode(baselineValidation);
        const baselineRotation = rotationOrderViolations(startKey);
        let bestMonth = null;
        let bestConflicts = baselineConflicts;

        runs.forEach(run => {
          // Quanti giorni mancano per arrivare al minimo: un frammento da 2
          // giorni ne richiede 2 in più, non solo 1 come per un frammento da
          // 3. Si prova ad aggiungerli tutti da un lato solo (prima del run
          // o dopo), senza uscire dalla settimana corrente.
          const deficit = activeRules().minSameShiftDays - run.keys.length;
          const windows = [];
          const prependIndexes = [];
          for(let i=deficit;i>=1;i -= 1) prependIndexes.push(run.startIndex-i);
          if(prependIndexes.every(index => index >= 0)) windows.push({indexes:prependIndexes,mode:'prepend'});
          const appendIndexes = [];
          for(let i=1;i<=deficit;i += 1) appendIndexes.push(run.endIndex+i);
          if(appendIndexes.every(index => index < weekKeys.length)) windows.push({indexes:appendIndexes,mode:'append'});

          windows.forEach(({indexes,mode}) => {
            const targetKeys = indexes.map(index => weekKeys[index]);
            // I giorni liberati (sourceCandidates) stanno sempre nel mese
            // attivo. Se il blocco venisse completato su giorni della settimana
            // a cavallo che appartengono al mese PRECEDENTE, lo spostamento
            // non sarebbe più a saldo zero: quel mese — già chiuso e già
            // riportato entro il tetto del punto 7 — ne guadagnerebbe e il mese
            // attivo ne perderebbe. Misurato 2026-08-07: il passaggio di
            // novembre riscriveva 9 celle di ottobre, PERETTO da 22 a 25
            // giorni in ottobre e a 19 in novembre.
            if(targetKeys.some(k => k.slice(0,7) !== mKey)) return;
            if(targetKeys.some(k => getShift(person.id,k) || lockedCells.has(cellKey(person.id,k)))) return;

            const sourceCandidates = [];
            for(let sourceDay=1;sourceDay<=nDays;sourceDay += 1){
              const sourceKey = dateKey(new Date(activeYear,activeMonth,sourceDay));
              if(targetKeys.includes(sourceKey) || weekKeys.includes(sourceKey) || sourceKey < startKey) continue;
              if(lockedCells.has(cellKey(person.id,sourceKey))) continue;
              if(!isWorkShift(getShift(person.id,sourceKey))) continue;
              if(!removalKeepsDailyRules(person,sourceKey)) continue;
              if(!removalKeepsWeeklyMinimum(person,sourceKey)) continue;
              // Punto 6: un giorno interno al blocco lo spezzerebbe in due tronconi
              // dello stesso turno.
              if(removalSplitsSameShiftBlock(person.id,sourceKey)) continue;
              sourceCandidates.push(sourceKey);
            }
            // Serve un giorno sorgente distinto (da liberare altrove, per
            // rispettare la quota mensile) per ciascun giorno bersaglio da
            // riempire: si prendono i più vicini, senza esplorare tutte le
            // combinazioni possibili quando il deficit è 2 o 3.
            if(sourceCandidates.length < targetKeys.length) return;
            const referenceKey = targetKeys[0];
            sourceCandidates.sort((a,b) => {
              const distanceA = Math.abs(parseDateKey(a)-parseDateKey(referenceKey));
              const distanceB = Math.abs(parseDateKey(b)-parseDateKey(referenceKey));
              return distanceA-distanceB || a.localeCompare(b);
            });
            const chosenSources = sourceCandidates.slice(0,targetKeys.length);

            state.schedules[mKey] = cloneData(baselineMonth);
            chosenSources.forEach(sourceKey => setShiftValue(person.id,sourceKey,''));
            targetKeys.forEach(targetKey => setShiftValue(person.id,targetKey,run.shift));

            // Punto 11 di "regola globale" (l'etichetta storica "Regola 9"
            // era il punto sbagliato): se il blocco si chiude con la notte,
            // i 2 giorni successivi devono restare liberi. Non è richiesto
            // che il rientro avvenga con il turno P. Con un'estensione
            // "prepend" il blocco finisce comunque sull'ultimo giorno del
            // run originale; con "append" finisce sull'ultimo giorno
            // aggiunto (bug corretto 2026-08-06).
            const blockEndKey = mode === 'append' ? targetKeys[targetKeys.length-1] : weekKeys[run.endIndex];
            if(run.shift === 'N' && getShift(person.id,dateKey(addDays(parseDateKey(blockEndKey),1))) !== 'N'){
              for(let offset=1;offset<=activeRules().restAfterNights;offset += 1){
                const restKey = dateKey(addDays(parseDateKey(blockEndKey),offset));
                if(lockedCells.has(cellKey(person.id,restKey))) continue;
                if(isWorkShift(getShift(person.id,restKey))) setShiftValue(person.id,restKey,'');
              }
            }

            const trial = validateSchedule();
            const weekStillBad = trial.month.some(item => item.staffId === person.id && item.code === 'STESSO_TURNO_CONSECUTIVO_MINIMO' && item.date && weekStartFor(item.date) === weekStart);
            // Punto 11 di "regola globale" non è mai negoziabile contro un
            // altro conflitto: un tentativo che fa scendere il totale ma
            // aumenta le violazioni di RIPOSO_DOPO_NOTTI viene scartato,
            // anche se il conteggio complessivo migliora (bug segnalato dalla
            // PM 2026-08-06: 7 persone su 13 con un blocco di notti seguito
            // da un solo giorno di riposo, causato proprio da questo
            // confronto sul totale che non isolava la regola).
            // Generalizzazione del controllo che prima isolava il solo punto 11:
            // nessuna delle regole inderogabili può peggiorare, non solo il
            // riposo dopo le notti (vedi INVIOLABLE_CONFLICT_CODES).
            const hardRuleWorsened = !noHardRuleGotWorse(baselineHardCounts,conflictCountsByCode(trial))
              || rotationOrderViolations(startKey) > baselineRotation;
            if(!weekStillBad && !hardRuleWorsened && trial.month.length < bestConflicts){
              bestConflicts = trial.month.length;
              bestMonth = cloneData(state.schedules[mKey]);
            }
          });
        });

        state.schedules[mKey] = bestMonth || baselineMonth;
        if(bestMonth) repaired += 1;
      });
    }
    return repaired;
  }

  function monthlyShiftMixCounts(person){
    const counts = {M:0,P:0,N:0};
    const nDays = daysInMonth(activeYear,activeMonth);
    for(let day=1;day<=nDays;day += 1){
      const key = dateKey(new Date(activeYear,activeMonth,day));
      const shift = getShift(person.id,key);
      if(Object.prototype.hasOwnProperty.call(counts,shift)) counts[shift] += 1;
    }
    return counts;
  }

  function monthlyShiftQuota(person){
    const usable = WORK_SHIFTS.filter(code => person.can[code] !== false);
    const monthShifts = ['M','P','N'].filter(code => usable.includes(code));
    const quota = {};
    if(!monthShifts.length) return quota;
    const total = monthlyWorkingDayTarget(activeYear,activeMonth);
    const base = Math.floor(total / monthShifts.length);
    let remainder = total - base * monthShifts.length;
    monthShifts.forEach(code => { quota[code] = base; });
    for(let i=0;i<remainder;i++){
      quota[monthShifts[i % monthShifts.length]] += 1;
    }
    return quota;
  }

  function historicalMonthlyShiftQuota(person){
    // Regola 12 (facoltativa/informativa, non usata dallo scoring
    // automatico): quota individuale calcolata dalle percentuali storiche
    // della persona (HISTORICAL_SHIFT_QUOTA_PCT). Usata solo da
    // rebalanceMonthlyShiftMix (richiusura post-hoc a settimane intere, con
    // le proprie verifiche di sicurezza su Regola 9 e celle bloccate) e dal
    // controllo di validazione TURNI_MESE_NON_EQUILIBRATI — MAI dal percorso
    // di scoring giorno-per-giorno (candidateScore/shiftSpreadPenalty/
    // chooseAutomaticShift), che resta sulla ripartizione uniforme di
    // monthlyShiftQuota. Le 7 colonne della tabella (M/P/N/GG feriale +
    // WKENDFESM/WKENDFESP/WKENDFESN weekend+festivo fuso; GG non ha una
    // colonna weekend/festivo dalla rimozione del 2026-08-06) sono frazioni
    // dello STESSO totale di giorni lavorativi richiesti nel mese
    // (monthlyWorkingDayLimit, la stessa base della Regola 8 "giorni mese"):
    // per ogni persona in tabella le 7 percentuali sommano a ~1. Il target
    // per M/P/N è la somma delle sue 2 percentuali (feriale + weekend/
    // festivo fuso), per GG è solo la percentuale feriale, il tutto
    // moltiplicato per quello stesso totale, con un arrotondamento "resto
    // più grande" che garantisce
    // M+P+N+GG = monthlyWorkingDayLimit esatto. Le persone senza percentuali
    // storiche restano sulla ripartizione uniforme di monthlyShiftQuota,
    // invariata.
    const pct = HISTORICAL_SHIFT_QUOTA_PCT[person.id];
    if(!pct) return monthlyShiftQuota(person);
    const usable = WORK_SHIFTS.filter(code => person.can[code] !== false);
    const total = monthlyWorkingDayTarget(activeYear,activeMonth);
    const raw = {};
    WORK_SHIFTS.forEach(code => {
      raw[code] = usable.includes(code) ?
        ((pct[code]||0) + (pct['WKENDFES'+code]||0)) * total : 0;
    });
    const quota = {};
    let assigned = 0;
    WORK_SHIFTS.forEach(code => {
      quota[code] = Math.floor(raw[code]);
      assigned += quota[code];
    });
    const remainder = Math.max(0, Math.round(total - assigned));
    const byRemainder = WORK_SHIFTS
      .filter(code => usable.includes(code))
      .sort((a,b) => (raw[b]-Math.floor(raw[b])) - (raw[a]-Math.floor(raw[a])));
    for(let i=0;i<remainder && i<byRemainder.length;i++){
      quota[byRemainder[i]] += 1;
    }
    return quota;
  }

  // Regola 12 (generale): i turni M/P/N devono restare equilibrati fra loro
  // nel corso del mese. A differenza delle altre funzioni di chiusura, questa
  // ruota INTERE settimane fra un turno sovrarappresentato e uno
  // sottorappresentato, senza mai spezzare il blocco settimanale minimo
  // (Regola 4) e senza toccare le celle bloccate. Viene eseguita per ultima
  // in ogni closurePass in modo da non entrare in conflitto con le altre
  // riparazioni.
  function rebalanceMonthlyShiftMix(startKey,lockedCells){
    let changed = 0;
    const nDays = daysInMonth(activeYear,activeMonth);
    const checkedWeeks = new Set();

    for(let day=1;day<=nDays;day += 1){
      const key = dateKey(new Date(activeYear,activeMonth,day));
      if(key < startKey || !rulesApplyTo(key)) continue;
      const weekStart = weekStartFor(key);
      if(checkedWeeks.has(weekStart) || !fullWeekIsInsideActiveMonth(weekStart)) continue;
      checkedWeeks.add(weekStart);

      state.staff.forEach(person => {
        const usable = WORK_SHIFTS.filter(code => person.can[code] !== false);
        if(usable.length < 2) return;
        const monthShifts = ['M','P','N'].filter(code => usable.includes(code));
        if(monthShifts.length < 2) return;

        const runs = sameShiftRunsInWeek(person.id,weekStart).filter(run => run.keys.length >= activeRules().minSameShiftDays);
        if(!runs.length) return;
        const block = runs[0];
        if(!monthShifts.includes(block.shift)) return;
        if(block.keys.some(dKey => lockedCells.has(cellKey(person.id,dKey)))) return;

        const counts = monthlyShiftMixCounts(person);
        const quota = historicalMonthlyShiftQuota(person);
        if(counts[block.shift] - (quota[block.shift]||0) <= 1) return;

        const under = monthShifts.reduce((worst,code) =>
          (counts[code]-(quota[code]||0)) < (counts[worst]-(quota[worst]||0)) ? code : worst, monthShifts[0]);
        if(under === block.shift || (quota[under]||0) - counts[under] <= 0) return;

        // Riferimento del punto 6 preso PRIMA di qualsiasi modifica: sotto si
        // svuotano i blocchi e si riscrivono, quindi la catena di rotazione va
        // confrontata con questo valore per non peggiorarla.
        const baselineRotation = rotationOrderViolations(startKey);

        // 1) Preferred: like-for-like swap with a partner whose own full-week
        // block in the same week already covers the under-represented shift.
        const partner = state.staff.find(other => {
          if(other.id === person.id) return false;
          if(other.can[block.shift] === false || other.can[under] === false) return false;
          if(block.keys.some(dKey => lockedCells.has(cellKey(other.id,dKey)))) return false;
          return sameShiftRunsInWeek(other.id,weekStart).some(run =>
            run.shift === under && run.startIndex === block.startIndex && run.keys.length === block.keys.length
          );
        });

        if(partner){
          const partnerBlock = sameShiftRunsInWeek(partner.id,weekStart).find(run =>
            run.shift === under && run.startIndex === block.startIndex && run.keys.length === block.keys.length
          );
          const personOriginal = block.keys.map(dKey => getShift(person.id,dKey));
          const partnerOriginal = partnerBlock.keys.map(dKey => getShift(partner.id,dKey));
          block.keys.forEach(dKey => setShiftValue(person.id,dKey,''));
          partnerBlock.keys.forEach(dKey => setShiftValue(partner.id,dKey,''));
          const forwardOk = block.keys.every(dKey => postPassAssignmentAllowed(partner,dKey,block.shift)) &&
            partnerBlock.keys.every(dKey => postPassAssignmentAllowed(person,dKey,under));
          if(forwardOk){
            block.keys.forEach(dKey => setShiftValue(partner.id,dKey,block.shift));
            partnerBlock.keys.forEach(dKey => setShiftValue(person.id,dKey,under));
            // postPassAssignmentAllowed convalida l'inizio del blocco spostato
            // ma non il blocco SUCCESSIVO delle due persone, che dopo lo
            // scambio si ritrova fuori dalla sequenza M->N->P: va ricontrollata
            // l'intera catena (punto 6, richiesta PM 2026-08-07).
            if(allSameShiftRunsMeetMinimum(person.id,weekStart) && allSameShiftRunsMeetMinimum(partner.id,weekStart)
               && rotationOrderViolations(startKey) <= baselineRotation){
              changed += 1;
              return;
            }
          }
          // Roll back: the swap did not hold under every rule.
          block.keys.forEach((dKey,idx) => setShiftValue(person.id,dKey,personOriginal[idx]));
          partnerBlock.keys.forEach((dKey,idx) => setShiftValue(partner.id,dKey,partnerOriginal[idx]));
          return;
        }

        // 2) Fallback: no direct swap partner found. Re-derive the block on
        // the under-represented shift only if every day still passes the
        // normal post-pass assignment checks and the weekly minimum holds.
        if(block.keys.some(dKey => !removalKeepsDailyRules(person,dKey) || !removalKeepsWeeklyMinimum(person,dKey))) return;
        const original = block.keys.map(dKey => getShift(person.id,dKey));
        block.keys.forEach(dKey => setShiftValue(person.id,dKey,''));
        const canRebuild = block.keys.every(dKey => postPassAssignmentAllowed(person,dKey,under));
        if(canRebuild){
          block.keys.forEach(dKey => setShiftValue(person.id,dKey,under));
          if(allSameShiftRunsMeetMinimum(person.id,weekStart)
             && rotationOrderViolations(startKey) <= baselineRotation){
            changed += 1;
            return;
          }
        }
        block.keys.forEach((dKey,idx) => setShiftValue(person.id,dKey,original[idx]));
      });
    }
    return changed;
  }

  // Punto 11 di "regola globale": dopo un blocco che si chiude con la notte
  // servono sempre 2 giorni pieni di riposo. I passaggi di riparazione
  // (completeWeeklyConsecutiveBlocks, rebalanceMonthlyTotals,
  // rebalanceMonthlyShiftMix, repairThreeDayWeeklyRuns) scrivono su celle
  // diverse in momenti diversi: una cella accettabile quando viene scritta
  // può diventare una violazione dopo che un altro passaggio ha aggiunto una
  // notte accanto. Questo passaggio finale ripulisce ciò che resta, provando
  // prima a passare il turno a un collega per non perdere la copertura
  // minima, e solo dopo a svuotare la cella (richiesta PM 2026-08-06, T4).
  function findShiftReplacement(person,dKey,lockedCells){
    const shift = getShift(person.id,dKey);
    if(!isWorkShift(shift)) return null;
    return state.staff.find(other =>
      other.id !== person.id &&
      !lockedCells.has(cellKey(other.id,dKey)) &&
      postPassAssignmentAllowed(other,dKey,shift)) || null;
  }

  function handOverShiftToColleague(person,dKey,lockedCells){
    const shift = getShift(person.id,dKey);
    const replacement = findShiftReplacement(person,dKey,lockedCells);
    if(!replacement) return false;
    setShiftValue(person.id,dKey,'');
    setShiftValue(replacement.id,dKey,shift);
    return true;
  }

  // Regola inderogabile valida per TUTTE le persone (richiesta PM 2026-08-07):
  // dopo MAX_CONSECUTIVE_GG_DAYS giorni consecutivi di GG il giorno successivo
  // deve essere di riposo. hardAssignmentAllowed la impone già a chi scrive
  // passando dai gate, ma diversi passaggi di riparazione scrivono anche per
  // altre vie: questo passaggio finale toglie il turno rimasto al posto del
  // riposo, provando prima a passarlo a un collega per non perdere copertura.
  // Il conteggio del blocco parte dai giorni precedenti (anche del mese prima),
  // così un blocco a cavallo di due mesi non azzera il contatore.
  function repairConsecutiveGGViolations(startKey,lockedCells){
    let repaired = 0;
    const nDays = daysInMonth(activeYear,activeMonth);
    const firstKey = dateKey(new Date(activeYear,activeMonth,1));
    state.staff.forEach(person => {
      let ggRun = countAdjacentDays(person.id,firstKey,value => value === 'GG',-1);
      for(let day=1;day<=nDays;day += 1){
        const dKey = dateKey(new Date(activeYear,activeMonth,day));
        const shift = getShift(person.id,dKey);
        const fixable = dKey >= startKey && rulesApplyTo(dKey) && !lockedCells.has(cellKey(person.id,dKey));
        if(ggRun >= MAX_CONSECUTIVE_GG_DAYS && isWorkShift(shift) && fixable){
          if(!handOverShiftToColleague(person,dKey,lockedCells)) setShiftValue(person.id,dKey,'');
          repaired += 1;
          ggRun = 0;
          continue;
        }
        ggRun = shift === 'GG' ? ggRun + 1 : 0;
      }
    });
    return repaired;
  }

  function repairNightRestViolations(startKey,lockedCells){
    let repaired = 0;
    const nDays = daysInMonth(activeYear,activeMonth);
    state.staff.forEach(person => {
      for(let day=1;day<=nDays;day += 1){
        const d = new Date(activeYear,activeMonth,day);
        const lastNightKey = dateKey(d);
        if(lastNightKey < startKey || !rulesApplyTo(lastNightKey)) continue;
        if(getShift(person.id,lastNightKey) !== 'N') continue;
        // Il blocco non si chiude qui se il giorno dopo è ancora notte.
        if(getShift(person.id,dateKey(addDays(d,1))) === 'N') continue;

        const busy = [];
        for(let offset=1;offset<=activeRules().restAfterNights;offset += 1){
          const restKey = dateKey(addDays(d,offset));
          if(isWorkShift(getShift(person.id,restKey))) busy.push(restKey);
        }
        if(!busy.length) continue;

        // Ricostruisce il blocco di notti che si chiude in questo giorno.
        const nightBlock = [];
        let cursor = d;
        while(getShift(person.id,dateKey(cursor)) === 'N'){
          nightBlock.unshift(dateKey(cursor));
          cursor = addDays(cursor,-1);
        }

        const freeable = keys => keys.every(key =>
          key >= startKey && !lockedCells.has(cellKey(person.id,key)));
        // Si libera il lato più corto: un blocco di notti isolato vale meno
        // dei giorni già pianificati dopo il riposo, e viceversa.
        const orderedTargets = nightBlock.length <= busy.length
          ? [nightBlock,busy]
          : [busy,nightBlock];

        // Si decide prima, si scrive dopo: ogni giorno del lato scelto deve
        // poter essere passato a un collega oppure svuotato senza scendere
        // sotto i minimi. Se nessuno dei due lati è liberabile così, vince
        // comunque il punto 11 sul lato più corto: la copertura mancante
        // viene ricostruita dal giro successivo del ciclo di chiusura e resta
        // comunque segnalata come conflitto.
        const resolvable = target => freeable(target) && target.every(key =>
          removalKeepsDailyRules(person,key) || findShiftReplacement(person,key,lockedCells));
        const chosen = orderedTargets.find(resolvable) ||
          orderedTargets.find(freeable);
        if(!chosen) continue;
        chosen.forEach(key => {
          if(!handOverShiftToColleague(person,key,lockedCells)) setShiftValue(person.id,key,'');
        });
        repaired += chosen.length;
      }
    });
    return repaired;
  }

  function autoRepairFrom(startKey,lockedCells){
    const monthEnd = new Date(activeYear,activeMonth+1,0);
    const monthEndKey = dateKey(monthEnd);
    if(startKey > monthEndKey){
      return {changed:0,attempted:false,remaining:validation.month.length};
    }

    const startDate = parseDateKey(startKey);
    const oldAssignments = {};
    eachDate(startDate,monthEnd,d => {
      const key = dateKey(d);
      state.staff.forEach(person => {
        oldAssignments[cellKey(person.id,key)] = getShift(person.id,key);
      });
    });

    // Replan automatic M/P/N/GG. Manual values and all absence/rest statuses remain fixed.
    eachDate(startDate,monthEnd,d => {
      const key = dateKey(d);
      state.staff.forEach(person => {
        const keyCell = cellKey(person.id,key);
        const shift = getShift(person.id,key);
        // Le celle MANUALI vengono sempre conservate dalla ripianificazione,
        // anche quando violano una regola individuale FISSA (es. Degrandi
        // feriale = GG): l'input manuale del PM ha l'ultima parola e non viene
        // più liberato né azzerato qui (autorizzazione PM 2026-08-12, che
        // sostituisce la logica 2026-08-07 per cui la regola fissa svuotava la
        // cella manuale al giro di ripianificazione). Il conflitto resta
        // visibile tramite validateSchedule, ma la cella scritta a mano non
        // cambia. Solo i turni automatici (M/P/N/GG) non bloccati vengono
        // azzerati e ricalcolati.
        if(AUTO_SHIFT_CODES.includes(shift) && !lockedCells.has(keyCell)) setShiftValue(person.id,key,'');
      });
    });

    const planner = buildPlannerStates(startDate);
    // I blocchi contati mentre si ricostruisce lo storico non consumano la
    // scelta della fase: quella riguarda il primo blocco DENTRO l'orizzonte.
    //
    // Azzerare ad ogni mese però regalerebbe una nuova scelta di fase ad ogni
    // mese pianificato, e al confine fra due mesi la sequenza M->N->P
    // risulterebbe rotta (misurato 2026-08-07: 15 transizioni fuori ordine su
    // 196 fra settembre e dicembre). La ridistribuzione delle persone sulle
    // fasi avviene una volta sola, nel primo mese della ripianificazione.
    if(!rotationPhaseShuffleDone){
      planner.forEach(ps => { ps.horizonBlocks = 0; });
      rotationPhaseShuffleDone = true;
    }
    const monthlyLimit = monthlyWorkingDayTarget(activeYear,activeMonth);

    eachDate(startDate,monthEnd,d => {
      const info = getDayInfo(d);
      const assigned = assignedPeopleForDate(info.key);
      const minimums = targetsFor(info);

      // 1) Prima garantisce sempre i minimi (M/P/N); GG è indipendente e non
      // contribuisce più alla copertura di M o P. Il riempimento dei minimi è
      // EQUO fra i tre turni: ad ogni assegnazione si sceglie il turno
      // ancora più indietro rispetto al proprio minimo residuo (deficit più
      // grande), invece di esaurire prima tutti i candidati di N, poi tutti
      // quelli di P, e solo alla fine provare M — ordine fisso che lasciava
      // sistematicamente M sotto minimo quando il personale disponibile
      // finiva prima del suo turno (bug segnalato dalla PM 2026-08-05).
      const required = {};
      const silvio = findSpecialPerson('silvio-morello','SILVIO MORELLO');
      ['N','P','M'].forEach(shift => {
        let req = minimums[shift];
        if(requiresCompanion(info) && silvio && assigned[shift].includes(silvio.id) && assignedCoverageCount(assigned,shift) < 2) req = Math.max(req,2);
        required[shift] = req;
      });
      let progressed = true;
      while(progressed){
        progressed = false;
        const deficits = ['N','P','M']
          .map(shift => ({shift, deficit: required[shift] - assignedCoverageCount(assigned,shift)}))
          .filter(entry => entry.deficit > 0)
          .sort((a,b) => b.deficit - a.deficit);
        for(const {shift} of deficits){
          // Punto 7 di "regola globale" (bug segnalato dalla PM 2026-08-07):
          // i giorni di weekend/festivo si sommano a quelli feriali dentro lo
          // stesso tetto mensile, ma questa lista ignorava SEMPRE il tetto
          // (enforceMonthlyLimit = false). Chi aveva già esaurito il budget
          // continuava a ricevere giorni e chiudeva il mese a 24-25 (misurato
          // su ottobre 2026: MENEGHIN 22 feriali + 3 weekend = 25).
          //
          // Il tetto ora è INDEROGABILE anche qui: se nessuno è disponibile
          // sotto il tetto la giornata resta scoperta e viene segnalata,
          // invece di far sforare qualcuno. È la scelta indicata dalla PM
          // (2026-08-07): superare i giorni massimi del mese è un errore,
          // mentre sulla copertura la regola chiede ">= minimo" e una
          // giornata corta resta visibile come conflitto da risolvere a mano.
          const chosen = state.staff
            .filter(person => candidateAllowed(person,shift,d,info,planner.get(person.id),assigned,required[shift],monthlyLimit,lockedCells,true))
            .sort((a,b) => candidateScore(a,shift,info,planner.get(a.id),oldAssignments) - candidateScore(b,shift,info,planner.get(b.id),oldAssignments))[0];
          if(!chosen) continue;
          setShiftValue(chosen.id,info.key,shift);
          assigned[shift].push(chosen.id);
          progressed = true;
          break;
        }
      }

      promoteAssignedToGG(info,assigned);

      // DEGRANDI ROBERTO - regola individuale fissa (DEGRANDI_RULE_TEXT): dal
      // lunedì al venerdì il suo turno è GG e nient'altro. La M del sabato
      // resta al normale giro di copertura, che passa comunque da
      // hardAssignmentAllowed e ne rispetta il tetto mensile.
      const degrandi = findSpecialPerson('degrandi-roberto','DEGRANDI');
      if(rulesApplyTo(info.key) && degrandi && !info.weekend && !info.fest && !getShift(degrandi.id,info.key)){
        const degrandiState = planner.get(degrandi.id);
        if(candidateAllowed(degrandi,'GG',d,info,degrandiState,assigned,2,monthlyLimit,lockedCells)){
          setShiftValue(degrandi.id,info.key,'GG');
          assigned.GG.push(degrandi.id);
        }
      }

      addSilvioCompanion(d,info,planner,assigned,oldAssignments,monthlyLimit,lockedCells);
      fillPlannedWorkingDay(d,info,planner,assigned,oldAssignments,monthlyLimit,lockedCells);
      promoteAssignedToGG(info,assigned);
      addSilvioCompanion(d,info,planner,assigned,oldAssignments,monthlyLimit,lockedCells);

      state.staff.forEach(person => advancePlannerDay(planner.get(person.id),getShift(person.id,info.key),d));
    });

    // Close the rule set iteratively: weekly blocks can add work days,
    // monthly balancing can remove other days, and daily coverage may require
    // relocations. Repeating the cycle prevents one repair from undoing another.
    for(let closurePass=0;closurePass<5;closurePass += 1){
      completeWeeklyConsecutiveBlocks(startKey,lockedCells);
      rebalanceMonthlyTotals(startKey,lockedCells,monthlyLimit);
      normalizeDegrandiAssignments(startKey,lockedCells);
      repairDailyCoverageBySwitching(startKey,lockedCells);
      repairThreeDayWeeklyRuns(startKey,lockedCells);
      repairDailyCoverageBySwitching(startKey,lockedCells);
      rebalanceMonthlyShiftMix(startKey,lockedCells);
      // Punto 11 di "regola globale" è inderogabile (richiesta PM
      // 2026-08-06, T4): passa per ultimo, così qualunque violazione
      // introdotta dai passaggi precedenti — che scrivono anche senza
      // postPassAssignmentAllowed — viene comunque rimossa prima della
      // chiusura del ciclo.
      repairNightRestViolations(startKey,lockedCells);
      // Stessa logica del punto 11 per la regola dei 5 GG consecutivi: anche
      // questa è inderogabile, quindi gira in coda al ciclo e ripulisce ciò
      // che i passaggi che scrivono senza postPassAssignmentAllowed hanno
      // lasciato indietro (richiesta PM 2026-08-07).
      repairConsecutiveGGViolations(startKey,lockedCells);
    }
    // L'ultimo passaggio del ciclo (repairNightRestViolations) toglie giorni,
    // quindi può lasciare un turno scoperto proprio in chiusura senza che
    // nessuno lo ripari più: erano i due turni rimasti a ZERO il 13/09 e il
    // 31/10 (segnalati dalla PM 2026-08-07). La riparazione della copertura
    // gira quindi anche dopo il ciclo, ed è a parità di giorni.
    repairDailyCoverageBySwitching(startKey,lockedCells);
    // Punto 7 di "regola globale": il tetto mensile deve essere l'ULTIMO
    // invariante ricontrollato. Alcuni passaggi di riparazione scrivono anche
    // per vie che non passano da postPassAssignmentAllowed, e nell'ultimo giro
    // del ciclo nessuno ricontrollava più il tetto (bug segnalato dalla PM
    // 2026-08-07). Non può ricreare uno scoperto: removalKeepsDailyRules
    // rifiuta ogni rimozione che porti un turno sotto il minimo.
    rebalanceMonthlyTotals(startKey,lockedCells,monthlyLimit);
    // Ultimo passaggio in assoluto: nessun turno resta senza nessuno.
    enforceOnePersonPerShift(startKey,lockedCells);
    repairAutomaticRunInvariants(startKey,lockedCells);
    // La pulizia dei blocchi automatici può togliere 1-2 giorni: il floor
    // mensile va quindi chiuso DOPO la pulizia, non prima.
    rebalanceMonthlyTotals(startKey,lockedCells,monthlyLimit);
    // This is the last automatic writer: balancing above can remove a cell,
    // so the no-zero floor must be restored after it.
    enforceOnePersonPerShift(startKey,lockedCells);

    let changed = 0;
    Object.entries(oldAssignments).forEach(([key,oldValue]) => {
      const [staffId,dKey] = key.split('|');
      if(getShift(staffId,dKey) !== oldValue) changed += 1;
    });
    const after = validateSchedule();
    return {changed,attempted:true,remaining:conflictsFrom(after,startKey).length,validation:after};
  }

  function applyScheduleChanges(changes,label){
    const permitted = changes.filter(change => !isHistoricalDate(change.date));
    if(!permitted.length){
      setAutoPlanStatus(historicalMonthMessage(),true);
      refreshPlanningKeepScroll();
      return;
    }
    const candidates = permitted.filter(change => getShift(change.staffId,change.date) !== change.value || !isManualCell(change.staffId,change.date));

    // L'input manuale del PM ha SEMPRE l'ultima parola: la cella viene scritta
    // esattamente al valore richiesto e l'eventuale conflitto (bordo rosso,
    // tooltip, conteggio) viene solo SEGNALATO, mai bloccato. Vale anche
    // sopra le regole individuali FISSE (es. Degrandi feriale = GG) e sopra
    // l'assenza di abilitazione (person.can[turno] === false): si può portare
    // una cella da GG a M e viceversa (autorizzazione PM 2026-08-12, che
    // sostituisce la decisione 2026-08-07 per cui la regola fissa batteva
    // l'input manuale). Le celle manuali restano tali e la ripianificazione
    // automatica le conserva.
    const effective = candidates;
    if(!effective.length){
      setAutoPlanStatus('Nessuna modifica da applicare',false);
      refreshPlanningKeepScroll();
      return;
    }

    pushUndo(label);
    effective.forEach(change => setManualShift(change.staffId,change.date,change.value));
    selectedDateKey = effective[effective.length-1].date;
    validation = validateSchedule();
    saveState();
    refreshPlanningKeepScroll();
    updateRangeSelection();
    const conflicts = validation.month.length;
    setAutoPlanStatus(
      `Input manuale registrato (${effective.length} celle). Premere “Pianificazione automatica” per completare dal ${formatConflictDate(state.pendingReplanFrom)}.`,
      conflicts > 0
    );
  }

  // Nome del pulsante che ha lanciato la passata: compare nella barra di stato
  // e nell'avviso finale, così la combinazione mostrata è sempre riferibile a
  // uno dei due contatori (richiesta PM 2026-08-07).
  function planPassLabel(improve){
    return improve ? 'MIGLIORA PIANIFICAZIONE' : 'PIANIFICAZIONE AUTOMATICA';
  }

  // improve = true quando la passata parte dal pulsante "Migliora
  // pianificazione". Migliora usa la finestra scorrevole del mese visualizzato
  // più il successivo; la pianificazione automatica conserva il suo orizzonte
  // di tre mesi. Entrambe preservano gli input manuali.
  function runPlanningPass(improve,startKeyOverride=null){
    const visibleYear = activeYear;
    const visibleMonth = activeMonth;
    const visibleSelectedDate = selectedDateKey;
    if(isHistoricalMonth(visibleYear,visibleMonth)){
      setAutoPlanStatus(historicalMonthMessage(),true);
      return historicalMonthMessage();
    }
    // Automatic planning always rebuilds the displayed month from its first
    // editable day. The selected cell must never leave the beginning of the
    // month unplanned.
    const displayedMonthStart = dateKey(new Date(visibleYear,visibleMonth,1));
    const startKey = repairStartFor(startKeyOverride || displayedMonthStart);
    const startDate = parseDateKey(startKey);
    const planningMonthCount = 2;
    const planningMonths = Array.from({length:planningMonthCount},(_,offset) => {
      const date = new Date(startDate.getFullYear(),startDate.getMonth()+offset,1);
      return {year:date.getFullYear(),month:date.getMonth()};
    });
    const horizonEndKey = dateKey(new Date(startDate.getFullYear(),startDate.getMonth()+planningMonthCount,0));

    pushUndo(`${improve ? 'Migliora pianificazione' : 'Pianificazione automatica'} dal ${formatConflictDate(startKey)} al ${formatConflictDate(horizonEndKey)}`);

    // Da qui in poi valgono i minimi della seconda serie e la deroga al blocco
    // settimanale minimo. Tutto il resto (rotazione, tetto mensile, 7 giorni
    // consecutivi, riposi, abilitazioni, regole individuali) resta identico:
    // la PM ha escluso esplicitamente ogni altra deroga.
    improvePlanRun = improve;
    // Combinazione di questa pressione. Premere di nuovo lo stesso pulsante
    // produce la combinazione successiva; dopo PLAN_VARIANT_COUNT si ricomincia
    // dalla prima. La combinazione 1 riproduce esattamente il comportamento
    // storico (nessuna perturbazione).
    const variantIndex = takePlanVariant(improve ? 'improve' : 'auto');
    planVariantIndex = variantIndex;

    let totalChanged = 0;
    let totalRemaining = 0;
    let plannedMonths = 0;
    // La scelta della fase di rotazione si esercita nel primo mese di QUESTA
    // esecuzione e vale per tutti i mesi successivi.
    rotationPhaseShuffleDone = false;

    for(const planMonth of planningMonths){
      activeYear = planMonth.year;
      activeMonth = planMonth.month;
      const monthStartKey = dateKey(new Date(activeYear,activeMonth,1));
      const monthEndKey = dateKey(new Date(activeYear,activeMonth+1,0));
      const effectiveStartKey = planMonth === planningMonths[0] ? startKey : monthStartKey;
      if(effectiveStartKey > monthEndKey) continue;

      // Manual entries, absences, GG and explicit blanks remain protected.
      const locked = new Set(
        Object.keys(state.manualCells || {}).filter(key => {
          const dKey = key.split('|')[1];
          return dKey >= effectiveStartKey && dKey <= monthEndKey;
        })
      );

      const result = autoRepairFrom(effectiveStartKey,locked);
      totalChanged += result.changed || 0;
      totalRemaining += conflictsFrom(result.validation || validateSchedule(),effectiveStartKey).length;
      plannedMonths += 1;
    }

    // Passata finale su tutto l'orizzonte. Ogni mese viene pianificato quando
    // i mesi successivi sono ancora vecchi, quindi le riparazioni di copertura
    // valutano i giorni a cavallo con dati che poi cambiano: era il motivo per
    // cui restava scoperto il turno N del 31/10 (l'unica persona utilizzabile
    // risultava bloccata dal 1° novembre non ancora ripianificato). Qui lo
    // stato è definitivo. Entrambe le operazioni sono a parità di giorni o
    // riportano dentro il tetto, quindi non possono violare il punto 7.
    for(const planMonth of planningMonths){
      activeYear = planMonth.year;
      activeMonth = planMonth.month;
      const monthStartKey = dateKey(new Date(activeYear,activeMonth,1));
      const monthEndKey = dateKey(new Date(activeYear,activeMonth+1,0));
      const effectiveStartKey = planMonth === planningMonths[0] ? startKey : monthStartKey;
      if(effectiveStartKey > monthEndKey) continue;
      const locked = new Set(
        Object.keys(state.manualCells || {}).filter(key => {
          const dKey = key.split('|')[1];
          return dKey >= effectiveStartKey && dKey <= monthEndKey;
        })
      );
      repairDailyCoverageBySwitching(effectiveStartKey,locked);
      rebalanceMonthlyTotals(effectiveStartKey,locked,monthlyWorkingDayTarget(activeYear,activeMonth));
      // Con l'orizzonte ormai definitivo, la garanzia "almeno 1 persona per
      // turno" viene riverificata su ogni mese: è l'ultima cosa che tocca il
      // piano prima di mostrarlo.
      enforceOnePersonPerShift(effectiveStartKey,locked);
      repairAutomaticRunInvariants(effectiveStartKey,locked);
      // Anche nell'ultima passata la chiusura del floor viene dopo ogni
      // rimozione automatica di frammenti inferiori al minimo.
      rebalanceMonthlyTotals(effectiveStartKey,locked,monthlyWorkingDayTarget(activeYear,activeMonth));
      enforceOnePersonPerShift(effectiveStartKey,locked);
    }

    activeYear = visibleYear;
    activeMonth = visibleMonth;
    selectedDateKey = visibleSelectedDate;
    // I minimi della seconda serie e la deroga al blocco settimanale valgono
    // SOLO durante l'esecuzione. La validazione mostrata alla PM torna subito
    // quella di sempre, con gli stessi conflitti di prima (richiesta PM
    // 2026-08-07: "冲突不收，保留和现在一样的效果").
    improvePlanRun = false;
    pruneShiftLeaders();
    validation = validateSchedule();
    const monthlyFloorBlocks = validation.month.filter(item => item.code === 'GIORNI_MESE_NON_UGUALI');
    state.pendingReplanFrom = null;
    saveState();
    refreshPlanningKeepScroll();

    // Messaggio ridotto alla sola combinazione (richiesta PM 2026-08-07): il
    // resto del riepilogo non serve. totalRemaining resta solo per colorare la
    // barra quando restano conflitti.
    const blockedPeople = [...new Set(monthlyFloorBlocks.map(item => state.staff.find(person => person.id === item.staffId)?.name).filter(Boolean))];
    const summary = monthlyFloorBlocks.length
      ? `${planPassLabel(improve)} completata con avviso quota mensile: ${blockedPeople.join(', ')} richiede programmazione manuale; celle manuali, assenze e regole hard sono state mantenute.`
      : `${planPassLabel(improve)} · Combinazione ${variantIndex+1}/${PLAN_VARIANT_COUNT} (premere di nuovo per la successiva)`;
    setAutoPlanStatus(summary,totalRemaining > 0 || monthlyFloorBlocks.length > 0);
    return summary;
  }

  // Il flag improvePlanRun cambia i minimi di copertura e la deroga al blocco
  // settimanale per tutta la durata della passata: va spento comunque, anche
  // se la passata si interrompe con un errore, altrimenti la pagina resterebbe
  // a validare con i parametri sbagliati.
  //
  // La passata è lunga e blocca il thread: prima si accende il puntatore di
  // attesa e si lascia ridisegnare il browser (requestAnimationFrame +
  // setTimeout), altrimenti il cambio di cursore non si vedrebbe mai. Alla fine
  // un avviso conferma che il lavoro è concluso (richiesta PM 2026-08-07).
  async function runAutomaticPlanning(improve,startKeyOverride=null){
    const runningBtn = improve ? els.improvePlanBtn : els.autoPlanBtn;
    document.body.classList.add('planning-busy');
    els.autoPlanBtn.disabled = true;
    els.improvePlanBtn.disabled = true;
    // Entrambi i pulsanti vanno bloccati per non lanciare due passate insieme,
    // ma solo quello premuto resta acceso: senza questo si vedevano tutti e due
    // cambiare colore e non si capiva quale fosse partito.
    runningBtn.classList.add('running');
    setAutoPlanStatus(`${planPassLabel(improve)} in corso…`);
    await new Promise(resolve => requestAnimationFrame(() => setTimeout(resolve,0)));
    let summary = '';
    try{
      summary = runPlanningPass(improve === true,startKeyOverride) || '';
    }finally{
      improvePlanRun = false;
      planVariantIndex = 0;
      document.body.classList.remove('planning-busy');
      runningBtn.classList.remove('running');
      const historical = isHistoricalMonth(activeYear,activeMonth);
      els.autoPlanBtn.disabled = !sharedLoaded || historical;
      els.improvePlanBtn.disabled = els.autoPlanBtn.disabled;
    }
    alert(`DONE\n\n${summary}`);
  }

  function replanAfterGeneralChange(label,startKey,statusLead){
    pushUndo(label);
    state.pendingReplanFrom = minDateKey([state.pendingReplanFrom,startKey]);
    validation = validateSchedule();
    saveState();
    refreshPlanningKeepScroll();
    setAutoPlanStatus(`${statusLead || 'Dati del personale aggiornati.'} Premere “Pianificazione automatica” per ricalcolare dal ${formatConflictDate(state.pendingReplanFrom)}.`,validation.month.length > 0);
  }

  function validateSchedule(){
    const result = emptyValidation();
    const monthStart = new Date(activeYear,activeMonth,1);
    const monthEnd = new Date(activeYear,activeMonth+1,0);
    const scanStart = addDays(monthStart,-40);
    const scanEnd = addDays(monthEnd,40);
    const nDays = daysInMonth(activeYear,activeMonth);

    // 1. Minimo giornaliero e abilitazioni personali.
    for(let day=1;day<=nDays;day++){
      const d = new Date(activeYear,activeMonth,day);
      const info = getDayInfo(d);
      const {counts,coverage} = getCountsForDate(info.key);
      const targets = targetsFor(info);

      const maxima = maxCoverageFor(info);
      ['M','P','N'].forEach(code => {
        if(info.key >= GLOBAL_RULES_EFFECTIVE_FROM && coverage[code] > maxima[code]){
          addDayConflict(result,info.key,`MAX_${code}`,`${code}: copertura ${coverage[code]}, massimo consentito ${maxima[code]}.`);
        }
        if(coverage[code] === 0){
          addDayConflict(
            result,
            info.key,
            'TURNO_VUOTO',
            `${code}: nessuna persona assegnata; l'automatico deve mantenere almeno una persona per turno.`
          );
        }
        if(coverage[code] < targets[code]){
          addDayConflict(
            result,
            info.key,
            `MIN_${code}`,
            `${code}: copertura ${coverage[code]} (${counts[code]} turno ${code}), minimo richiesto ${targets[code]}.`
          );
        }
      });

      state.staff.forEach(person => {
        const shift = getShift(person.id,info.key);
        if(!isWorkShift(shift)) return;
        if(person.can[shift] === false){
          addCellConflict(result,person.id,info.key,'ABILITAZIONE_TURNO',`non abilitato al turno ${shift}.`);
        }
        if(info.weekend && ['M','P','N'].includes(shift) && person.can['WKENDFES'+shift] === false){
          addCellConflict(result,person.id,info.key,'ABILITAZIONE_WEEKEND',`non abilitato al weekend per il turno ${shift}.`);
        }
        if(info.fest && ['M','P','N'].includes(shift) && person.can['WKENDFES'+shift] === false){
          addCellConflict(result,person.id,info.key,'ABILITAZIONE_FEST',`non abilitato ai festivi per il turno ${shift}.`);
        }
        if(rulesApplyTo(info.key) && (info.weekend || info.fest) && shift === 'GG'){
          addCellConflict(result,person.id,info.key,'GG_SOLO_FERIALE','la giornata (GG) vale solo dal lunedì al venerdì, non nel weekend/festivo.');
        }
        // DEGRANDI ROBERTO - regola individuale fissa (DEGRANDI_RULE_TEXT).
        // Vincolo gemello di quello in hardAssignmentAllowed: dal lunedì al
        // venerdì solo GG, M solo al sabato, la domenica mai.
        if(rulesApplyTo(info.key) && isDegrandi(person)){
          const required = degrandiRequiredShift(d,info);
          if(shift !== required){
            addCellConflict(result,person.id,info.key,'DEGRANDI_TURNO_FISSO',degrandiShiftMessage(d,info));
          }
        }
        if(rulesApplyTo(info.key) && isGrassis(person) && !grassisShiftAllowed(person,info.key,shift)){
          addCellConflict(result,person.id,info.key,'GRASSIS_TURNO_FISSO',grassisShiftMessage(person,info.key,shift));
        }
        const weekday = d.getDay();
        if(rulesApplyTo(info.key) && weekday >= 1 && weekday <= 5 && isCominelli(person) && shift !== 'GG'){
          addCellConflict(result,person.id,info.key,'COMINELLI_SOLO_GG','dal lunedì al venerdì può lavorare soltanto nel turno GG.');
        }
      });

      ['M','P','N','GG'].forEach(shift => {
        const highPeople = state.staff.filter(person => isHighLevel(person) && getShift(person.id,info.key) === shift);
        if(highPeople.length >= 2){
          highPeople.forEach(person => {
            addCellConflict(result,person.id,info.key,'LIVELLO_ALTO_STESSO_TURNO',`nel turno ${shift} sono presenti ${highPeople.length} operatori di livello Alto; il massimo consentito è 1.`);
          });
        }
      });
    }

    // 2. Regole specifiche riportate nel foglio Regola.
    const cipolla = findSpecialPerson('cipolla-eugenio','CIPOLLA');
    const grassis = findSpecialPerson('grassis-marco','GRASSIS');
    const silvio = findSpecialPerson('silvio-morello','SILVIO MORELLO');

    for(let day=1;day<=nDays;day++){
      const d = new Date(activeYear,activeMonth,day);
      const info = getDayInfo(d);
      const {counts} = getCountsForDate(info.key);

      if(cipolla && grassis){
        const cShift = getShift(cipolla.id,info.key);
        const gShift = getShift(grassis.id,info.key);
        if(isWorkShift(cShift) && cShift === gShift){
          addCellConflict(result,cipolla.id,info.key,'COPPIA_STESSO_TURNO',`non può essere nello stesso turno di ${grassis.name}.`);
          addCellConflict(result,grassis.id,info.key,'COPPIA_STESSO_TURNO',`non può essere nello stesso turno di ${cipolla.name}.`);
        }
      }

      if(silvio && requiresCompanion(info)){
        const shift = getShift(silvio.id,info.key);
        if(isWorkShift(shift) && counts[shift] < 2){
          addCellConflict(result,silvio.id,info.key,'NON_DA_SOLO',`nel weekend e nei festivi non può lavorare da solo nel turno ${shift}.`);
        }
      }
    }

    // DEGRANDI ROBERTO - regola individuale fissa (DEGRANDI_RULE_TEXT), parte
    // "riposo" e parte "tetto mensile dei sabati in M". I vincoli di turno per
    // singolo giorno (GG lun-ven, M solo il sabato, domenica mai) sono nella
    // sezione 1.
    const degrandi = findSpecialPerson('degrandi-roberto','DEGRANDI');
    if(degrandi){
      const checkedWeeks = new Set();
      for(let day=1;day<=nDays;day++){
        const key = dateKey(new Date(activeYear,activeMonth,day));
        if(!rulesApplyTo(key)) continue;
        const weekStart = weekStartFor(key);
        if(checkedWeeks.has(weekStart)) continue;
        checkedWeeks.add(weekStart);
        const first = parseDateKey(weekStart);
        const weekKeys = Array.from({length:7},(_,offset)=>dateKey(addDays(first,offset)));
        if(weekKeys.every(dKey => isWorkShift(getShift(degrandi.id,dKey)))){
          weekKeys.filter(currentMonthContains).forEach(dKey => {
            addCellConflict(result,degrandi.id,dKey,'DEGRANDI_RIPOSO_SETTIMANA','deve avere almeno un giorno di riposo nella settimana da lunedì a domenica.');
          });
        }
      }

      // Il riposo va collocato liberamente, ma mai oltre
      // DEGRANDI_MAX_CONSECUTIVE_WORK_DAYS giorni di lavoro consecutivi.
      let degrandiRun = [];
      const flushDegrandiRun = () => {
        if(degrandiRun.length > DEGRANDI_MAX_CONSECUTIVE_WORK_DAYS){
          const message = `${degrandiRun.length} giorni consecutivi di lavoro: dopo ${DEGRANDI_MAX_CONSECUTIVE_WORK_DAYS} giorni consecutivi serve 1 giorno di riposo.`;
          degrandiRun.forEach(dKey => {
            if(currentMonthContains(dKey)){
              addCellConflict(result,degrandi.id,dKey,'DEGRANDI_RIPOSO_DOPO_5_GIORNI',message);
            }
          });
        }
        degrandiRun = [];
      };
      eachDate(scanStart,scanEnd,d => {
        const key = dateKey(d);
        if(isWorkShift(getShift(degrandi.id,key))) degrandiRun.push(key);
        else flushDegrandiRun();
      });
      flushDegrandiRun();

      // Al massimo DEGRANDI_MAX_SATURDAY_M sabati in M per mese.
      const saturdayMKeys = [];
      for(let day=1;day<=nDays;day++){
        const d = new Date(activeYear,activeMonth,day);
        const key = dateKey(d);
        if(!rulesApplyTo(key) || d.getDay() !== 6) continue;
        if(getShift(degrandi.id,key) === 'M') saturdayMKeys.push(key);
      }
      if(saturdayMKeys.length > DEGRANDI_MAX_SATURDAY_M){
        const message = `può fare al massimo ${DEGRANDI_MAX_SATURDAY_M} sabati in M al mese; questo mese sono ${saturdayMKeys.length}.`;
        saturdayMKeys.slice(DEGRANDI_MAX_SATURDAY_M).forEach(key => {
          addCellConflict(result,degrandi.id,key,'DEGRANDI_MAX_SABATI_M',message);
        });
      }
    }

    // 3. Continuità fra mesi. Regola 6 e regola 7: il 6° giorno consecutivo
    // è sempre ammesso senza bisogno di giustificarlo con una carenza di
    // copertura, il 7° è sempre vietato (richiesta PM 2026-08-06).
    state.staff.forEach(person => {
      let run = [];
      const flushRun = () => {
        if(run.length > MAX_CONSECUTIVE_WORK_DAYS_SHORTAGE){
          const message = `${run.length} giorni consecutivi: 7 giorni consecutivi sono vietati.`;
          run.forEach(dKey => {
            if(currentMonthContains(dKey)){
              addCellConflict(result,person.id,dKey,'GIORNI_CONSECUTIVI',message);
            }
          });
        }
        run = [];
      };

      eachDate(scanStart,scanEnd,d => {
        const key = dateKey(d);
        if(isWorkShift(getShift(person.id,key))) run.push(key);
        else flushRun();
      });
      flushRun();
    });

    // 3-bis. Regola inderogabile valida per TUTTE le persone (richiesta PM
    // 2026-08-07): dopo MAX_CONSECUTIVE_GG_DAYS giorni consecutivi di GG serve
    // 1 giorno di riposo. Il controllo segnala il primo giorno che segue il
    // blocco quando è ancora un turno di lavoro: vale sia per un 6° GG di fila
    // sia per un M/P/N messo al posto del riposo obbligatorio.
    state.staff.forEach(person => {
      let ggRun = 0;
      eachDate(scanStart,scanEnd,d => {
        const key = dateKey(d);
        const shift = getShift(person.id,key);
        if(ggRun >= MAX_CONSECUTIVE_GG_DAYS && isWorkShift(shift) && rulesApplyTo(key) && currentMonthContains(key)){
          addCellConflict(result,person.id,key,'RIPOSO_DOPO_5_GG',`dopo ${MAX_CONSECUTIVE_GG_DAYS} giorni consecutivi di GG serve 1 giorno di riposo.`);
        }
        ggRun = shift === 'GG' ? ggRun + 1 : 0;
      });
    });

    // 4. Regola 9: se il turno finisce con la notte, sempre 2 giorni di
    // riposo. Vale per qualunque blocco che si chiude con N, indipendentemente
    // da quante notti contiene. Non è richiesto alcun rientro al turno P.
    state.staff.forEach(person => {
      eachDate(scanStart,scanEnd,d => {
        const lastNightKey = dateKey(d);
        if(getShift(person.id,lastNightKey) !== 'N') return;
        if(getShift(person.id,dateKey(addDays(d,1))) === 'N') return;

        let restViolation = false;
        for(let offset=1;offset<=activeRules().restAfterNights;offset += 1){
          const restKey = dateKey(addDays(d,offset));
          if(!isWorkShift(getShift(person.id,restKey))) continue;
          restViolation = true;
          if(currentMonthContains(restKey)){
            addCellConflict(result,person.id,restKey,'RIPOSO_DOPO_NOTTI',`dopo un blocco che termina con la notte sono obbligatori ${activeRules().restAfterNights} giorni di riposo.`);
          }
        }
        if(restViolation && currentMonthContains(lastNightKey)){
          addCellConflict(result,person.id,lastNightKey,'RIPOSO_DOPO_NOTTI',`questa notte chiude il blocco e non è seguita da ${activeRules().restAfterNights} giorni completi di riposo.`);
        }
      });
    });

    // 5. Da agosto 2026: almeno 11 ore fra un turno e l'altro e nessun turno
    // N il giorno dopo un P. La vecchia regola "oltre 5 giorni nello stesso
    // turno serve un riposo nella settimana successiva" non è più presente
    // nel foglio Regola ed è stata rimossa.
    state.staff.forEach(person => {
      eachDate(scanStart,addDays(scanEnd,-1),d => {
        const previousKey = dateKey(d);
        const nextKey = dateKey(addDays(d,1));
        const previousShift = getShift(person.id,previousKey);
        const nextShift = getShift(person.id,nextKey);
        if(rulesApplyTo(nextKey) && previousShift === 'P' && nextShift === 'N' && currentMonthContains(nextKey)){
          addCellConflict(result,person.id,nextKey,'P_DOPO_N_VIETATO','dopo un turno P non può essere assegnato il turno N del giorno successivo.');
        }else if(rulesApplyTo(nextKey) && !respectsMinimumRest(previousShift,nextShift) && currentMonthContains(nextKey)){
          addCellConflict(result,person.id,nextKey,'RIPOSO_MINIMO_11H',`tra ${previousShift} e ${nextShift} ci sono ${minimumRestHours(previousShift,nextShift)} ore di riposo; il minimo è 11 ore.`);
        }
      });
    });

    // 6. Ogni blocco M/P/N/GG deve rispettare il minimo anche attraverso il
    // confine settimana/mese; non esistono eccezioni personali.
    const checkedShiftRuns = new Set();
    for(let day=1;day<=nDays;day++){
      const key = dateKey(new Date(activeYear,activeMonth,day));
      if(!rulesApplyTo(key)) continue;
      state.staff.forEach(person => {
        const run = sameShiftRunAt(person.id,key);
        if(!run.keys.length || run.keys.length >= activeRules().minSameShiftDays) return;
        const signature = `${person.id}|${run.shift}|${run.keys[0]}|${run.keys[run.keys.length-1]}`;
        if(checkedShiftRuns.has(signature)) return;
        checkedShiftRuns.add(signature);
        run.keys.filter(currentMonthContains).forEach(dKey => {
          addCellConflict(result,person.id,dKey,'STESSO_TURNO_CONSECUTIVO_MINIMO',`ogni blocco ${run.shift} richiede almeno ${activeRules().minSameShiftDays} giorni consecutivi; si considerano soltanto M, P, N e GG.`);
        });
      });
    }

    // 7. A maximum of three distinct people may be on FERIE in a Mon-Sun week.
    const checkedFerieWeeks = new Set();
    for(let day=1;day<=nDays;day++){
      const key = dateKey(new Date(activeYear,activeMonth,day));
      if(!rulesApplyTo(key)) continue;
      const weekStart = weekStartFor(key);
      if(checkedFerieWeeks.has(weekStart)) continue;
      checkedFerieWeeks.add(weekStart);
      const feriePeople = feriePeopleInWeek(weekStart);
      if(feriePeople.size > activeRules().maxWeeklyFeriePeople){
        feriePeople.forEach(personId => {
          const person = state.staff.find(item => item.id === personId);
          if(person) addPersonMonthConflict(result,person.id,'MAX_FERIE_SETTIMANA',`${feriePeople.size} persone in FERIE nella settimana dal ${formatConflictDate(weekStart)}; il massimo Ã¨ ${activeRules().maxWeeklyFeriePeople}.`);
        });
      }
    }

    // 8. Dal 01/09/2026, ogni stato non vuoto eccetto . e RIPOSO conta come
    // giorno di lavoro e deve restare nel limite mensile configurato.
    if(dateKey(monthStart) >= GLOBAL_RULES_EFFECTIVE_FROM){
      const monthlyLimit = monthlyWorkingDayTarget(activeYear,activeMonth);
      const monthlyLimitMin = Math.max(0, monthlyLimit - activeRules().waivedWorkDays);
      state.staff.forEach(person => {
        const plannedDates = [];
        for(let day=1;day<=nDays;day++){
          const key = dateKey(new Date(activeYear,activeMonth,day));
          if(isMonthlyPlannedStatus(getShift(person.id,key),key)) plannedDates.push(key);
        }
        if(plannedDates.length < monthlyLimitMin || plannedDates.length > monthlyLimit){
          const message = plannedDates.length < monthlyLimitMin
            ? `AVVISO QUOTA MENSILE: ${plannedDates.length} giorni conteggiati (ogni stato non vuoto, esclusi . e RIPOSO); il minimo inderogabile è ${monthlyLimitMin}. Completare manualmente senza modificare celle manuali, assenze o regole hard.`
            : `${plannedDates.length} giorni conteggiati (ogni stato non vuoto, esclusi . e RIPOSO); il totale richiesto per il mese è tra ${monthlyLimitMin} e ${monthlyLimit} (lun–ven, esclusi festivi).`;
          addPersonMonthConflict(result,person.id,'GIORNI_MESE_NON_UGUALI',message);
          if(plannedDates.length > monthlyLimit){
            plannedDates.slice(monthlyLimit).forEach(key => addCellConflict(result,person.id,key,'GIORNI_MESE_NON_UGUALI',message));
          }
        }
      });
    }

    // 8-bis. Punto 15: nessuno puo' lavorare tutti i weekend del mese (di
    // norma 2). Punto 16: il conteggio parte dal mese precedente per i weekend
    // a cavallo, perche' sabato e domenica sono letti sul calendario reale.
    if(dateKey(monthStart) >= GLOBAL_RULES_EFFECTIVE_FROM){
      const weekendTotal = weekendIdsInMonth(activeYear,activeMonth).size;
      state.staff.forEach(person => {
        const worked = workedWeekendIds(person.id,activeYear,activeMonth);
        if(weekendTotal > 1 && worked.size >= weekendTotal){
          addPersonMonthConflict(result,person.id,'TUTTI_WEEKEND_MESE',`lavora tutti i ${weekendTotal} weekend del mese; di norma ${activeRules().maxWeekendsPerPerson}, mai tutti.`);
        }
      });
    }

    // 9. Regola 12 (generale, informativa): tutte le persone devono avere i
    // turni M/P/N/GG equilibrati rispetto alla propria quota storica
    // (historicalMonthlyShiftQuota) nel corso del mese attivo. Controllo
    // puramente di reporting: non guida l'assegnazione automatica, che resta
    // sulla ripartizione uniforme di monthlyShiftQuota (vedi shiftSpreadPenalty).
    if(rulesApplyTo(dateKey(monthStart))){
      state.staff.forEach(person => {
        const usable = WORK_SHIFTS.filter(code => person.can[code] !== false);
        if(usable.length < 2) return;
        const monthShifts = ['M','P','N','GG'].filter(code => usable.includes(code));
        if(monthShifts.length < 2) return;

        const counts = {M:0,P:0,N:0,GG:0};
        for(let day=1;day<=nDays;day++){
          const key = dateKey(new Date(activeYear,activeMonth,day));
          const shift = getShift(person.id,key);
          if(Object.prototype.hasOwnProperty.call(counts,shift)) counts[shift] += 1;
        }

        const quota = historicalMonthlyShiftQuota(person);
        const unbalanced = monthShifts.filter(code => Math.abs(counts[code]-(quota[code]||0)) > 1);
        if(unbalanced.length){
          const quotaText = monthShifts.map(code => `${code} atteso ${quota[code]||0}`).join(', ');
          const message = `Turni non equilibrati nel mese: M=${counts.M}, P=${counts.P}, N=${counts.N}, GG=${counts.GG} (${quotaText}; scostamento oltre 1 giorno dalla quota per ${unbalanced.join(', ')}).`;
          addPersonMonthConflict(result,person.id,'TURNI_MESE_NON_EQUILIBRATI',message);
        }
      });
    }

    // 10. Regola 12 (T2, segnalazione, non usata dallo scoring): per le
    // persone con riga in HISTORICAL_SHIFT_QUOTA_PCT, confronta i conteggi
    // reali del mese salvato (ricalcolati da computeHistoricalQuotaMonthCounts,
    // non dallo stato live del planner) con la fascia più larga (fascia 2,
    // ±0.2%, historicalQuotaBand(pct,true)) di ciascuna delle 7 colonne,
    // escluse le 3 celle esentate (HISTORICAL_QUOTA_EXEMPT_CELLS). Qui non
    // c'è capacità residua da valutare — il mese è già salvato — quindi si
    // usa sempre la fascia più larga invece della logica a due fasce di
    // historicalQuotaCellStatus (pensata per lo scoring durante la
    // pianificazione). Segnala inoltre, per ogni persona con riga storica,
    // se la somma dei 7 target arrotondati (historicalQuotaTargetsSum) esce
    // dall'intervallo della Regola 8: è una proprietà delle percentuali
    // storiche/dell'arrotondamento, indipendente dai giorni effettivamente
    // assegnati. Entrambi i controlli sono segnalazioni per revisione
    // manuale, non un'affermazione su quale regola le abbia causate, e non
    // alterano in alcun modo l'assegnazione o le altre validazioni.
    if(rulesApplyTo(dateKey(monthStart))){
      const monthlyLimitForQuota = monthlyWorkingDayTarget(activeYear,activeMonth);
      state.staff.forEach(person => {
        const pct = HISTORICAL_SHIFT_QUOTA_PCT[person.id];
        if(!pct) return;

        const counts = computeHistoricalQuotaMonthCounts(person);
        HISTORICAL_QUOTA_COLUMNS.forEach(column => {
          if(pct[column] === undefined) return;
          if(HISTORICAL_QUOTA_EXEMPT_CELLS.has(person.id+':'+column)) return;
          const current = counts[column] || 0;
          const band = historicalQuotaBand(pct[column],true);
          if(current < band.lower || current > band.upper){
            const target = Math.round(pct[column] * monthlyLimitForQuota);
            const message = `Colonna storica ${column}: ${current} giorni nel mese, fuori dalla fascia di tolleranza [${band.lower}-${band.upper}] (target ${target}); da verificare manualmente, non un'assegnazione errata accertata.`;
            addPersonMonthConflict(result,person.id,'STORICO_PERCENTUALE_FUORI_BANDA',message);
          }
        });

        const targetsSum = historicalQuotaTargetsSum(person);
        if(targetsSum && !targetsSum.inRange){
          const message = `Somma dei 7 target storici arrotondati (${targetsSum.sum}) fuori dall'intervallo atteso [${targetsSum.monthlyLimit - activeRules().waivedWorkDays}, ${targetsSum.monthlyLimit}]; verificare le percentuali storiche/l'arrotondamento, non un'assegnazione errata accertata.`;
          addPersonMonthConflict(result,person.id,'STORICO_PERCENTUALE_SOMMA_FUORI_RANGE',message);
        }
      });
    }

    return result;
  }

  function formatConflictDate(dKey){
    if(!dKey) return 'Mese';
    return new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'2-digit'}).format(parseDateKey(dKey));
  }

  function renderConflictBanner(){
    const total = validation.month.length;
    els.conflictBanner.className = 'conflict-banner';
    if(total === 0){
      els.conflictBanner.classList.add('ok');
      els.conflictBanner.innerHTML = '<span>Nessun conflitto rilevato nel mese.</span><span>✓</span>';
      return;
    }
    els.conflictBanner.classList.add('show');
    els.conflictBanner.innerHTML = `<span>⚠ ${total} conflitti rilevati: controllare le celle rosse e il pannello a destra.</span><span>${total}</span>`;
  }


  function clamp(value,min,max){
    return Math.min(max,Math.max(min,value));
  }

  function applyPanelWidths(){
    if(!els.layout || window.innerWidth <= 1050) return;
    const left = clamp(Number(state.ui?.leftWidth || 280),220,520);
    const right = clamp(Number(state.ui?.rightWidth || 285),220,520);
    els.layout.style.setProperty('--left-width',`${left}px`);
    els.layout.style.setProperty('--right-width',`${right}px`);
  }

  function setupPanelResizer(handle,side){
    if(!handle || !els.layout) return;
    handle.addEventListener('pointerdown',event => {
      if(window.innerWidth <= 1050) return;
      event.preventDefault();
      handle.setPointerCapture(event.pointerId);
      handle.classList.add('dragging');
      document.body.classList.add('resizing-panels');

      const rect = els.layout.getBoundingClientRect();
      const startX = event.clientX;
      const startLeft = Number(state.ui?.leftWidth || 280);
      const startRight = Number(state.ui?.rightWidth || 285);
      const fixedSpace = 16 + 12; // due separatori + gap
      const minCenter = 500;

      const move = moveEvent => {
        const dx = moveEvent.clientX - startX;
        if(side === 'left'){
          const maxLeft = Math.max(220,rect.width - startRight - minCenter - fixedSpace);
          state.ui.leftWidth = Math.round(clamp(startLeft + dx,220,Math.min(520,maxLeft)));
        }else{
          const maxRight = Math.max(220,rect.width - startLeft - minCenter - fixedSpace);
          state.ui.rightWidth = Math.round(clamp(startRight - dx,220,Math.min(520,maxRight)));
        }
        applyPanelWidths();
      };

      const stop = () => {
        handle.classList.remove('dragging');
        document.body.classList.remove('resizing-panels');
        handle.removeEventListener('pointermove',move);
        handle.removeEventListener('pointerup',stop);
        handle.removeEventListener('pointercancel',stop);
        saveState();
      };

      handle.addEventListener('pointermove',move);
      handle.addEventListener('pointerup',stop);
      handle.addEventListener('pointercancel',stop);
    });
  }

  function initPanelResizers(){
    applyPanelWidths();
    setupPanelResizer(els.leftResizer,'left');
    setupPanelResizer(els.rightResizer,'right');
    window.addEventListener('resize',applyPanelWidths);
  }

  function populateSelectors(){
    const minYear = today.getFullYear()-2;
    const maxYear = today.getFullYear()+8;
    els.yearSelect.innerHTML = '';
    for(let y=minYear;y<=maxYear;y++){
      const opt = document.createElement('option');
      opt.value = y;
      opt.textContent = y;
      els.yearSelect.appendChild(opt);
    }
    els.monthSelect.innerHTML = MONTHS.map((m,i)=>`<option value="${i}">${m}</option>`).join('');
    els.yearSelect.value = activeYear;
    els.monthSelect.value = activeMonth;
  }

  function renderAll(){
    ensureMonth();
    validation = validateSchedule();
    els.yearSelect.value = activeYear;
    els.monthSelect.value = activeMonth;
    const historical = isHistoricalMonth(activeYear,activeMonth);
    els.autoPlanBtn.disabled = !sharedLoaded || historical;
    els.autoPlanBtn.title = historical ? historicalMonthMessage() : 'Mantiene gli input manuali e completa solo le coperture minime previste dalle regole';
    els.improvePlanBtn.disabled = !sharedLoaded || historical;
    els.improvePlanBtn.title = historical ? historicalMonthMessage() : IMPROVE_PLAN_BTN_TITLE;
    const clearMonthBtn = document.getElementById('clearMonthBtn');
    clearMonthBtn.disabled = historical;
    clearMonthBtn.title = historical ? historicalMonthMessage() : 'Svuota il mese visualizzato';
    const clearAllBtn = document.getElementById('clearAllBtn');
    // Non dipende dal mese visualizzato: parte sempre dallo stesso mese, così
    // il pulsante non cancella una porzione diversa a seconda di dove si
    // trova la vista.
    clearAllBtn.disabled = !sharedLoaded;
    clearAllBtn.title = `Cancella turni automatici, input manuali e assenze da ${describeMonthKey(firstClearableMonthKey())} in poi`;
    renderStaff();
    renderSchedule();
    renderRight();
    renderAbsenceList();
    updateContinuityInfo();
    updateSaveStatus(false);
    renderConflictBanner();
    updateUndoButton();
  }

  function refreshPlanningKeepScroll(){
    const wrap = document.getElementById('scheduleWrap');
    const left = wrap?.scrollLeft || 0;
    const top = wrap?.scrollTop || 0;
    validation = validateSchedule();
    renderSchedule();
    renderRight();
    renderConflictBanner();
    requestAnimationFrame(() => {
      if(wrap){
        wrap.scrollLeft = left;
        wrap.scrollTop = top;
      }
    });
  }

  function renderStaff(){
    els.staffBody.innerHTML = '';
    state.staff.forEach(person => {
      const tr = document.createElement('tr');
      const nameTd = document.createElement('td');
      const nameInput = document.createElement('input');
      nameInput.className = 'staff-name';
      nameInput.value = person.name;
      nameInput.addEventListener('change', () => {
        const nextName = nameInput.value.trim() || person.name;
        if(nextName === person.name) return;
        pushUndo(`Nome ${person.name}`);
        person.name = nextName;
        saveState();
        refreshPlanningKeepScroll();
        fillAbsenceStaff();
        setAutoPlanStatus('Nome aggiornato; turni invariati.');
      });
      nameTd.appendChild(nameInput);
      tr.appendChild(nameTd);

      const levelTd = document.createElement('td');
      const levelSelect = document.createElement('select');
      levelSelect.className = 'level-select';
      [['ALTO','Alto'],['MEDIO','Medio'],['BASSO','Basso']].forEach(([value,label]) => {
        const opt = document.createElement('option');
        opt.value = value;
        opt.textContent = label;
        levelSelect.appendChild(opt);
      });
      levelSelect.value = normalizeLevel(person.level);
      levelSelect.addEventListener('change', () => {
        if(levelSelect.value === person.level) return;
        pushUndo(`Livello ${person.name}`);
        person.level = levelSelect.value;
        state.pendingReplanFrom = minDateKey([state.pendingReplanFrom,dateKey(new Date(activeYear,activeMonth,1))]);
        validation = validateSchedule();
        saveState();
        refreshPlanningKeepScroll();
        setAutoPlanStatus(`Livello di ${person.name} aggiornato. Premere “Pianificazione automatica” per ricalcolare.`,validation.month.length > 0);
      });
      levelTd.appendChild(levelSelect);
      tr.appendChild(levelTd);

      ['M','P','N','GG','WKENDFESM','WKENDFESP','WKENDFESN'].forEach(code => {
        const td = document.createElement('td');
        const cb = document.createElement('input');
        cb.type = 'checkbox';
        cb.className = 'check';
        cb.checked = person.can[code] !== false;
        cb.title = `${person.name}: ${code}`;
        cb.addEventListener('change', () => {
          pushUndo(`Abilitazione ${person.name} ${code}`);
          person.can[code] = cb.checked;
          state.pendingReplanFrom = minDateKey([state.pendingReplanFrom,dateKey(new Date(activeYear,activeMonth,1))]);
          validation = validateSchedule();
          saveState();
          refreshPlanningKeepScroll();
          setAutoPlanStatus(`Abilitazione aggiornata. Premere “Pianificazione automatica” per ricalcolare tutti gli operatori.`,validation.month.length > 0);
        });
        td.appendChild(cb);
        tr.appendChild(td);
      });

      const deleteTd = document.createElement('td');
      deleteTd.className = 'staff-action-cell';
      const deleteBtn = document.createElement('button');
      deleteBtn.type = 'button';
      deleteBtn.className = 'staff-delete';
      deleteBtn.textContent = '×';
      deleteBtn.title = `Elimina ${person.name}`;
      deleteBtn.setAttribute('aria-label', `Elimina ${person.name}`);
      deleteBtn.addEventListener('click', () => removeStaff(person.id));
      deleteTd.appendChild(deleteBtn);
      tr.appendChild(deleteTd);

      els.staffBody.appendChild(tr);
    });
    fillAbsenceStaff();
  }

  function renderSchedule(){
    const nDays = daysInMonth(activeYear, activeMonth);
    const first = new Date(activeYear, activeMonth, 1);
    const historical = isHistoricalMonth(activeYear,activeMonth);
    selectedDateKey = selectedDateKey.startsWith(monthKey(activeYear,activeMonth))
      ? selectedDateKey : dateKey(first);

    els.monthTitle.textContent = `${MONTHS[activeMonth]} ${activeYear}`;
    const holidaysCount = Array.from({length:nDays}, (_,i)=>getDayInfo(new Date(activeYear,activeMonth,i+1)))
      .filter(x=>x.fest).length;
    els.monthSubtitle.textContent = `${nDays} giorni · ${holidaysCount} festività nazionali/aggiunte`;

    const table = els.scheduleTable;
    table.innerHTML = '';
    const thead = document.createElement('thead');

    // Always-visible daily coverage. GG is an independent category and does
    // NOT count toward M or P here (Regola aggiornata). The displayed
    // values are minima, never daily maximums.
    [
      {code:'M',label:'Mattina',count:result => result.coverage.M},
      {code:'P',label:'Pomeriggio',count:result => result.coverage.P},
      {code:'N',label:'Notte',count:result => result.counts.N}
    ].forEach(summary => {
      const row = document.createElement('tr');
      row.className = `coverage-row coverage-${summary.code}`;
      const label = document.createElement('th');
      label.textContent = `${summary.code} · ${summary.label}`;
      row.appendChild(label);
      for(let day=1;day<=nDays;day++){
        const d = new Date(activeYear,activeMonth,day);
        const info = getDayInfo(d);
        const count = summary.count(getCountsForDate(info.key));
        const minimum = targetsFor(info)[summary.code];
        const cell = document.createElement('th');
        cell.dataset.date = info.key;
        cell.className = `coverage-number ${count >= minimum ? 'coverage-ok' : 'coverage-bad'}`;
        cell.textContent = count;
        cell.title = `${summary.label}: ${count} persone · minimo ${minimum}`;
        cell.addEventListener('click', () => selectDate(info.key));
        row.appendChild(cell);
      }
      thead.appendChild(row);
    });

    const hr = document.createElement('tr');
    hr.className = 'day-header';
    const corner = document.createElement('th');
    corner.innerHTML = '<strong>Personale</strong><br><span style="color:var(--muted);font-size:10px">Turno per giorno</span>';
    hr.appendChild(corner);

    for(let day=1;day<=nDays;day++){
      const d = new Date(activeYear,activeMonth,day);
      const info = getDayInfo(d);
      const th = document.createElement('th');
      th.dataset.date = info.key;
      th.className = typeClass(info.type);
      if(dateHasConflict(info.key)) th.classList.add('header-invalid');
      if(info.key === selectedDateKey) th.classList.add('selected-col');
      th.innerHTML = `<span class="day-number">${day}</span><span class="day-name">${DAY_NAMES[d.getDay()]}</span><span class="day-type">${info.type}</span>`;
      th.title = info.holidayName || info.type;
      th.addEventListener('click', () => selectDate(info.key));
      hr.appendChild(th);
    }
    thead.appendChild(hr);
    table.appendChild(thead);

    const tbody = document.createElement('tbody');
    state.staff.forEach((person,rowIndex) => {
      const tr = document.createElement('tr');
      const name = document.createElement('th');
      name.textContent = person.name;
      name.title = person.name;
      if(personHasMonthConflict(person.id)){
        name.classList.add('row-invalid');
        const personMessages = validation.personMonth[person.id] || [];
        if(personMessages.length) name.title += `\n${personMessages.map(x=>x.message).join('\n')}`;
      }
      tr.appendChild(name);

      for(let day=1;day<=nDays;day++){
        const d = new Date(activeYear,activeMonth,day);
        const info = getDayInfo(d);
        const td = document.createElement('td');
        td.className = 'schedule-cell';
        td.dataset.date = info.key;
        td.dataset.staffId = person.id;
        td.dataset.row = rowIndex;
        td.dataset.col = day-1;
        if(historical) td.classList.add('historical-cell');
        if(info.key === selectedDateKey) td.classList.add('selected-col');
        if(isManualCell(person.id,info.key)) td.classList.add('manual-cell');
        const value = getShift(person.id, info.key);
        if(isShiftLeader(person.id,info.key,value)) td.classList.add('shift-leader');
        const selected = normalizeRange(selectedRange);
        if(rowIndex >= selected.r1 && rowIndex <= selected.r2 && day-1 >= selected.c1 && day-1 <= selected.c2) td.classList.add('range-selected');
        td.addEventListener('pointerdown', event => {
          if(event.target.closest('.fill-handle')) return;
          selectScheduleCell(rowIndex,day-1,event.shiftKey);
        });

        const sel = document.createElement('select');
        sel.className = 'shift-select';
        // Se la cella contiene un codice ritirato lo si aggiunge soltanto a
        // questa tendina, così il valore storico resta leggibile e non viene
        // azzerato dal render.
        const cellOptions = [
          ...(LEGACY_SHIFT_CODES.includes(value) ? [...SHIFT_OPTIONS,value] : SHIFT_OPTIONS),
          ...(isWorkShift(value) ? ['__CT__'] : [])
        ];
        cellOptions.forEach(code => {
          const opt = document.createElement('option');
          opt.value = code;
          opt.textContent = code === '__CT__' ? 'CT' : (code || '·');
          sel.appendChild(opt);
        });
        sel.value = value;
        sel.disabled = historical;
        applyShiftClass(sel, value);
        const cellConflicts = getCellConflicts(person.id,info.key);
        if(cellConflicts.length) sel.classList.add('invalid');
        sel.title = `${person.name} · ${day} ${MONTHS[activeMonth]} · ${info.type}` +
          (isManualCell(person.id,info.key) ? `\n● Input manuale protetto dalla pianificazione automatica` : `\n○ Valore automatico`) +
          (cellConflicts.length ? `\n⚠ ${cellConflicts.map(x=>x.message).join('\n⚠ ')}` : '');
        sel.addEventListener('focus', () => {
          selectDate(info.key);
          selectScheduleCell(rowIndex,day-1,false);
        });
        sel.addEventListener('change', () => {
          if(sel.value === '__CT__'){
            toggleShiftLeader(person.id,info.key,value);
            return;
          }
          applyScheduleChanges([{staffId:person.id,date:info.key,value:sel.value}],`Turno ${person.name} ${formatConflictDate(info.key)}`);
        });
        const handle = document.createElement('span');
        handle.className = 'fill-handle';
        handle.hidden = historical;
        handle.title = 'Trascina per copiare questo valore';
        handle.setAttribute('aria-label','Trascina per copiare il turno');
        handle.addEventListener('pointerdown', event => beginDragFill(event,td,sel.value));
        td.appendChild(sel);
        td.appendChild(handle);
        tr.appendChild(td);
      }
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
  }

  function typeClass(type){
    if(type === 'WKEND') return 'type-WKEND';
    if(type === 'FEST') return 'type-FEST';
    if(type === 'WKEND/FEST') return 'type-WKEND-FEST';
    if(type === 'CHIUSO') return 'type-CHIUSO';
    if(type === 'FEST/CHIUSO') return 'type-FEST-CHIUSO';
    return '';
  }

  function shiftCssClass(value){
    return `shift-${String(value || '').replace(/[^A-Za-z0-9_-]+/g,'-')}`;
  }

  function applyShiftClass(select, value){
    select.className = 'shift-select';
    if(value) select.classList.add(shiftCssClass(value));
  }

  function isAssignmentValid(person, info, shift){
    if(!shift || NON_SHIFT_STATUSES.includes(shift)) return true;
    if(['M','P','N','GG'].includes(shift) && person.can[shift] === false) return false;
    if((info.weekend || info.fest) && ['M','P','N'].includes(shift) && person.can['WKENDFES'+shift] === false) return false;
    if(rulesApplyTo(info.key) && (info.weekend || info.fest) && shift === 'GG') return false;
    return true;
  }

  function selectDate(key){
    selectedDateKey = key;
    document.querySelectorAll('[data-date]').forEach(el => {
      el.classList.toggle('selected-col', el.dataset.date === key);
    });
    renderRight();
  }

  function getCountsForDate(key){
    const counts = {M:0,P:0,N:0,GG:0};
    const names = {M:[],P:[],N:[],GG:[]};
    state.staff.forEach(p => {
      const s = getShift(p.id,key);
      if(counts[s] !== undefined){
        counts[s]++;
        names[s].push(p.name);
      }
    });
    const coverage = {
      M:counts.M,
      P:counts.P,
      N:counts.N,
      GG:counts.GG
    };
    return {counts,coverage,names};
  }

  // GG non ha mai un minimo di copertura: è una giornata intera assegnabile
  // solo dal lunedì al venerdì e non entra nel fabbisogno di turno.
  function targetsFor(info){
    if(info.closed) return {M:0,P:0,N:0,GG:0};
    const rules = activeRules();
    // "Migliora pianificazione" (richiesta PM 2026-08-07): durante la sua
    // esecuzione valgono i minimi della SECONDA serie, anch'essa mensile e
    // indipendente. Fuori dall'esecuzione il flag è spento, quindi la
    // validazione e tutto il resto della pagina continuano a vedere i minimi
    // di default esattamente come prima.
    if(improvePlanRun){
      if(info.weekend || info.fest) return {M:rules.impCovWeekendM,P:rules.impCovWeekendP,N:rules.impCovWeekendN,GG:0};
      return {M:rules.impCovWeekdayM,P:rules.impCovWeekdayP,N:rules.impCovWeekdayN,GG:0};
    }
    if(info.weekend || info.fest) return {M:rules.covWeekendM,P:rules.covWeekendP,N:rules.covWeekendN,GG:0};
    return {M:rules.covWeekdayM,P:rules.covWeekdayP,N:rules.covWeekdayN,GG:0};
  }

  function renderRight(){
    const d = parseDateKey(selectedDateKey);
    const info = getDayInfo(d);
    const {names} = getCountsForDate(selectedDateKey);

    els.selectedDateLabel.textContent = new Intl.DateTimeFormat('it-IT',{
      weekday:'long',day:'2-digit',month:'long',year:'numeric'
    }).format(d);
    els.selectedHolidayName.textContent = info.holidayName || 'Nessuna festività nazionale';
    els.selectedTypeBadge.textContent = info.type;

    els.shiftNames.innerHTML = ['M','P','N','GG'].map(code => `
      <div class="shift-row">
        <div class="shift-code shift-${code}">${code}</div>
        <div class="names">${names[code].length ? names[code].join(', ') : '<span style="color:var(--muted)">Nessuno</span>'}</div>
      </div>
    `).join('');

    const problems = (validation.day[selectedDateKey] || []).map(x => x.message);
    els.issues.innerHTML = problems.length
      ? problems.map(x=>`<div class="issue">${escapeHtml(x)}</div>`).join('')
      : '<div class="issue ok">La giornata rispetta tutte le regole configurate.</div>';

    renderMonthIssues();
    renderMonthlyTotals();
  }


  function renderMonthIssues(){
    const all = validation.month;
    els.monthConflictCount.textContent = all.length ? `(${all.length})` : '';
    if(!all.length){
      els.monthIssues.innerHTML = '<div class="issue ok">Nessun conflitto nel mese.</div>';
      return;
    }

    const visible = all.slice(0,30);
    els.monthIssues.innerHTML = visible.map((item,index) => {
      const person = item.staffId ? state.staff.find(p => p.id === item.staffId) : null;
      const who = person ? `${person.name}: ` : '';
      const date = item.date ? formatConflictDate(item.date) : 'Totale mese';
      return `<button type="button" class="month-issue" data-conflict-date="${item.date || ''}">
        ${escapeHtml(who + item.message)}
        <small>${escapeHtml(date)} · ${escapeHtml(item.code)}</small>
      </button>`;
    }).join('') + (all.length > visible.length
      ? `<div class="issue">Altri ${all.length-visible.length} conflitti non visualizzati: le relative celle restano evidenziate in rosso.</div>`
      : '');

    els.monthIssues.querySelectorAll('[data-conflict-date]').forEach(btn => {
      btn.addEventListener('click', () => {
        const key = btn.dataset.conflictDate;
        if(!key) return;
        selectDate(key);
        const header = document.querySelector(`thead [data-date="${key}"]`);
        header?.scrollIntoView({behavior:'smooth',block:'nearest',inline:'center'});
      });
    });
  }

  // Fix 2026-08-06 (segnalazione PM): la vecchia colonna WK/F sommava di
  // nuovo i turni M/P/N/GG del weekend/festivo già contati nelle colonne
  // M/P/N/GG, gonfiando il totale se le colonne venivano lette come somma
  // (es. Cipolla: M+P+N+WK/F+GG = 25 invece dei 22 giorni realmente
  // pianificati). "Tot. lavoro" (monthlyPlannedCount, invariata) non era mai
  // stata affetta perché calcolata da isMonthlyPlannedStatus giorno per
  // giorno, ma la tabella ora sostituisce la colonna WK/F cumulativa con le
  // 7 colonne mutuamente esclusive già usate dal reporting storico T2
  // (HISTORICAL_QUOTA_COLUMNS: M/P/N/GG feriale + WKENDFESM/P/N),
  // ricalcolate da computeHistoricalQuotaMonthCounts in modo che ogni
  // giorno lavorato cada in una sola colonna e la somma delle 7 colonne
  // torni a coincidere col totale corretto. Richiesta PM 2026-08-06: ogni
  // cella mostra anche la percentuale del turno sul totale dei giorni di
  // turno fisico della persona nel mese (somma delle 7 colonne, non
  // "Tot. lavoro" che include anche FERIE/MALATTIA/CORSO), per un confronto
  // visivo diretto con HISTORICAL_SHIFT_QUOTA_PCT.
  function renderMonthlyTotals(){
    const standardWorkableDays = monthlyWorkingDayLimit(activeYear,activeMonth);
    const targetWorkableDays = monthlyWorkingDayTarget(activeYear,activeMonth);
    els.monthlyTotals.innerHTML = state.staff.map(p => {
      const counts = computeHistoricalQuotaMonthCounts(p);
      const shiftTotal = HISTORICAL_QUOTA_COLUMNS.reduce((sum,column) => sum + (counts[column]||0),0);
      const planned = monthlyPlannedCount(p);
      const cell = column => {
        const n = counts[column] || 0;
        if(!n) return '0';
        const pct = shiftTotal > 0 ? Math.round((n/shiftTotal)*100) : 0;
        return `${n} (${pct}%)`;
      };
      const rowInvalid = personHasMonthConflict(p.id) ? ' class="invalid-row"' : '';
      const personProblems = (validation.personMonth[p.id] || []).map(x=>x.message).join(' ');
      return `<tr${rowInvalid}>
        <td title="${escapeHtml(p.name + (personProblems ? ' · ' + personProblems : ''))}">${escapeHtml(shortName(p.name))}</td>
        <td>${cell('M')}</td><td>${cell('P')}</td><td>${cell('N')}</td><td>${cell('GG')}</td><td>${cell('WKENDFESM')}</td><td>${cell('WKENDFESP')}</td><td>${cell('WKENDFESN')}</td><td>${planned}</td><td>${targetWorkableDays}/${standardWorkableDays}</td>
      </tr>`;
    }).join('');
  }

  function shortName(name){
    const parts = name.trim().split(/\s+/);
    if(parts.length <= 2) return name;
    return `${parts[0]} ${parts[1].charAt(0)}.`;
  }

  function updateContinuityInfo(){
    const previous = new Date(activeYear,activeMonth,0);
    const prevKey = monthKey(previous.getFullYear(),previous.getMonth());
    const hasPrev = state.schedules[prevKey] && Object.keys(state.schedules[prevKey]).length > 0;
    els.continuityInfo.textContent = hasPrev
      ? `Continuità: dati di ${MONTHS[previous.getMonth()]} disponibili`
      : `Continuità: ${MONTHS[previous.getMonth()]} non ancora compilato`;
  }

  function fillAbsenceStaff(){
    els.absenceStaff.innerHTML = state.staff.map(p=>`<option value="${p.id}">${escapeHtml(p.name)}</option>`).join('');
  }

  // Pannello "Gestione regole": i campi sono ricavati dai nomi di
  // RULE_DEFAULTS (covWeekdayM -> ruleCovWeekdayM), così aggiungere un
  // parametro richiede solo il default, il limite e il campo nel markup.
  const RULE_INPUT_IDS = Object.fromEntries(
    Object.keys(RULE_DEFAULTS).map(name => [name,`rule${name[0].toUpperCase()}${name.slice(1)}`])
  );

  function ruleInput(name){
    return document.getElementById(RULE_INPUT_IDS[name]);
  }

  function rulesMonthLabel(){
    return `${MONTHS[activeMonth]} ${activeYear}`;
  }

  function rulesMonthIsLocked(){
    return isHistoricalDate(`${monthKey(activeYear,activeMonth)}-01`);
  }

  function rulesAreGlobal(){
    return `${monthKey(activeYear,activeMonth)}-01` >= GLOBAL_RULES_EFFECTIVE_FROM;
  }

  // Un campo lasciato vuoto torna al default, non a zero.
  function readRulesForm(){
    const raw = {};
    Object.keys(RULE_DEFAULTS).forEach(name => {
      const input = ruleInput(name);
      const value = input ? String(input.value).trim() : '';
      if(value !== '') raw[name] = value;
    });
    return normalizeMonthRules(raw);
  }

  // Massimo per turno: 31 = nessun limite, mostrato come campo vuoto
  // (readRulesForm riporta il vuoto al default 31).
  const isShiftMaxRule = name => /^max(Weekday|Weekend)[MPN]$/.test(name);

  function fillRulesForm(values){
    Object.keys(RULE_DEFAULTS).forEach(name => {
      const input = ruleInput(name);
      if(!input) return;
      if(isShiftMaxRule(name)){
        input.placeholder = 'nessun limite';
        input.value = values[name] >= RULE_LIMITS[name][1] ? '' : values[name];
      } else input.value = values[name];
    });
    els.monthlyWorkingDayTarget.value = monthlyWorkingDayTarget(activeYear,activeMonth);
    els.monthlyWorkingDayStandard.value = monthlyWorkingDayLimit(activeYear,activeMonth);
    updateRulesWaivedNote();
  }

  function updateRulesWaivedNote(){
    const standardLimit = monthlyWorkingDayLimit(activeYear,activeMonth);
    const enteredTarget = Number(els.monthlyWorkingDayTarget.value);
    const limit = Number.isInteger(enteredTarget) && enteredTarget >= 1 && enteredTarget <= 31
      ? enteredTarget
      : monthlyWorkingDayTarget(activeYear,activeMonth);
    const waived = readRulesForm().waivedWorkDays;
    const floor = Math.max(0,limit-waived);
    els.rulesWaivedNote.innerHTML = waived > 0
      ? `Giorni lavorativi di ${rulesMonthLabel()}: <strong>${limit}/${standardLimit}</strong> (obiettivo/standard). Con ${waived} rinunciabile/i il totale di ogni persona può stare fra <strong>${floor}</strong> e <strong>${limit}</strong>; i giorni in meno vengono distribuiti a rotazione, partendo da chi non li ha ancora avuti nei mesi precedenti.`
      : `Giorni lavorativi di ${rulesMonthLabel()}: <strong>${limit}/${standardLimit}</strong> (obiettivo/standard). Con 0 rinunciabili ogni persona deve arrivare esattamente a <strong>${limit}</strong>.`;
  }

  // Regola individuale fissa di DEGRANDI ROBERTO: sola lettura, sempre
  // uguale in ogni mese. Non ha campi modificabili di proposito — è una
  // regola inderogabile, non un parametro (richiesta PM 2026-08-07).
  function updateRulesDegrandiNote(){
    els.rulesDegrandiNote.innerHTML =
      '<strong>Regola speciale e non modificabile.</strong> Questo riquadro mostra soltanto la regola individuale speciale, separata dai parametri globali; non ammette deroghe:<ul>' +
      DEGRANDI_RULE_TEXT.map(line => `<li>${escapeHtml(line)}</li>`).join('') +
      '</ul>';
  }

  function setRulesTab(tab){
    const global = tab === 'global';
    els.rulesGlobalTab.classList.toggle('active',global);
    els.rulesGlobalTab.setAttribute('aria-selected',String(global));
    els.rulesGlobalPanel.hidden = !global;
    els.rulesIndividualTab.classList.toggle('active',!global);
    els.rulesIndividualTab.setAttribute('aria-selected',String(!global));
    els.rulesIndividualPanel.hidden = global;
  }

  function openRulesModal(){
    const global = rulesAreGlobal();
    const locked = !global;
    updateRulesDegrandiNote();
    els.rulesTitle.textContent = global
      ? 'Gestione regole - Globale (da settembre 2026)'
      : `Gestione regole - Globale (storico: ${rulesMonthLabel()})`;
    fillRulesForm(rulesForMonth(monthKey(activeYear,activeMonth)));
    Object.keys(RULE_DEFAULTS).forEach(name => {
      const input = ruleInput(name);
      if(input) input.disabled = locked;
    });
    els.monthlyWorkingDayTarget.disabled = locked;
    els.applyRulesBtn.disabled = locked;
    els.resetRulesBtn.disabled = locked;
    els.rulesScopeNote.classList.toggle('blocked',locked);
    els.rulesScopeNote.innerHTML = locked
      ? `${historicalMonthMessage()} Le regole storiche sono in sola lettura.`
      : `Questi parametri sono <strong>globali</strong>: valgono da settembre 2026 per tutti i mesi successivi. <strong>Vincoli inderogabili:</strong> l'automatico non assegna oltre 5 giorni consecutivi, ogni blocco M/P/N/GG richiede almeno 3 giorni consecutivi e dopo 5 GG è obbligatorio un riposo. GG resta solo dal lunedì al venerdì. Al salvataggio, i turni idonei dal <strong>01/09/2026</strong> vengono ricalcolati immediatamente, preservando i blocchi manuali e le assenze.`;
    setRulesTab('global');
    els.rulesModal.classList.add('open');
  }

  function closeRulesModal(){
    els.rulesModal.classList.remove('open');
  }

  async function applyRulesChanges(){
    if(!rulesAreGlobal()){
      alert(`${historicalMonthMessage()} Le regole storiche sono in sola lettura.`);
      return;
    }
    const next = readRulesForm();
    const previous = normalizeMonthRules(state.globalRules);
    const mKey = monthKey(activeYear,activeMonth);
    const standardTarget = monthlyWorkingDayLimit(activeYear,activeMonth);
    const enteredTarget = Number(els.monthlyWorkingDayTarget.value);
    if(!Number.isInteger(enteredTarget) || enteredTarget < 1 || enteredTarget > 31){
      alert('Inserire un obiettivo mensile fra 1 e 31 giorni.');
      return;
    }
    const currentTarget = monthlyWorkingDayTarget(activeYear,activeMonth);
    const rulesChanged = Object.keys(RULE_DEFAULTS).some(name => previous[name] !== next[name]);
    const targetChanged = currentTarget !== enteredTarget;
    if(!rulesChanged && !targetChanged){
      closeRulesModal();
      setAutoPlanStatus('Regole globali invariate');
      return;
    }
    if(rulesChanged){
      state.globalRules = next;
      invalidateMonthRulesCache();
    }
    state.monthlyWorkingDayOverrides ||= {};
    if(enteredTarget === standardTarget) delete state.monthlyWorkingDayOverrides[mKey];
    else state.monthlyWorkingDayOverrides[mKey] = enteredTarget;
    closeRulesModal();
    pushUndo(rulesChanged ? 'Regole globali e obiettivo mensile' : 'Obiettivo mensile');
    await runAutomaticPlanning(false,repairStartFor(GLOBAL_RULES_EFFECTIVE_FROM));
  }

  function openAbsenceModal(){
    fillAbsenceStaff();
    const first = dateKey(new Date(activeYear,activeMonth,1));
    const last = dateKey(new Date(activeYear,activeMonth,daysInMonth(activeYear,activeMonth)));
    els.absenceStart.value = selectedDateKey || first;
    els.absenceEnd.value = selectedDateKey || last;
    els.absenceNote.value = '';
    els.absenceModal.classList.add('open');
  }

  function closeAbsenceModal(){
    els.absenceModal.classList.remove('open');
  }

  function applyAbsence(){
    const staffId = els.absenceStaff.value;
    const type = els.absenceType.value;
    const start = els.absenceStart.value;
    const end = els.absenceEnd.value;
    if(!staffId || !start || !end || start > end){
      alert('Controllare persona e intervallo date.');
      return;
    }
    if(isHistoricalDate(start) || isHistoricalDate(end)){
      alert(historicalMonthMessage());
      return;
    }
    if(type === 'FERIE'){
      const overflowWeek = firstFerieWeekOverflow(staffId,start,end);
      if(overflowWeek){
        alert(`Non Ã¨ possibile registrare questa ferie: nella settimana dal ${formatShortDate(overflowWeek)} il massimo Ã¨ ${activeRules().maxWeeklyFeriePeople} persone in ferie.`);
        return;
      }
    }
    const person = state.staff.find(p => p.id === staffId);
    pushUndo(`${type} ${person?.name || ''} ${formatConflictDate(start)}–${formatConflictDate(end)}`);
    state.absences.push({
      id:`a-${Date.now()}`,staffId,type,start,end,note:els.absenceNote.value.trim()
    });
    const cursor = parseDateKey(start);
    const endDate = parseDateKey(end);
    while(cursor <= endDate){
      setManualShift(staffId,dateKey(cursor),type);
      cursor.setDate(cursor.getDate()+1);
    }
    validation = validateSchedule();
    saveState();
    closeAbsenceModal();
    renderAll();
    setAutoPlanStatus(`Assenza registrata. Premere “Pianificazione automatica” per completare tutti gli altri turni dal ${formatConflictDate(state.pendingReplanFrom)}.`,validation.month.length > 0);
  }

  function renderAbsenceList(){
    const relevant = state.absences
      .filter(a => a.start.slice(0,7) === monthKey(activeYear,activeMonth) || a.end.slice(0,7) === monthKey(activeYear,activeMonth))
      .sort((a,b)=>a.start.localeCompare(b.start));
    els.absenceList.innerHTML = relevant.length ? relevant.map(a => {
      const p = state.staff.find(x=>x.id===a.staffId);
      return `<div class="absence-item">
        <div><strong>${escapeHtml(p?.name || 'Persona rimossa')}</strong><br>${a.type} · ${formatShortDate(a.start)} – ${formatShortDate(a.end)}${a.note?` · ${escapeHtml(a.note)}`:''}</div>
        <button class="btn small danger" data-remove-absence="${a.id}">Elimina</button>
      </div>`;
    }).join('') : '<div class="helper">Nessuna assenza registrata per il mese.</div>';

    els.absenceList.querySelectorAll('[data-remove-absence]').forEach(btn => {
      btn.addEventListener('click', () => removeAbsence(btn.dataset.removeAbsence));
    });
  }

  function removeAbsence(id){
    const a = state.absences.find(x=>x.id===id);
    if(!a) return;
    if(!confirm('Eliminare questa assenza?')) return;
    const person = state.staff.find(p => p.id === a.staffId);
    pushUndo(`Elimina ${a.type} ${person?.name || ''}`);
    const cursor = parseDateKey(a.start);
    const endDate = parseDateKey(a.end);
    while(cursor <= endDate){
      const key = dateKey(cursor);
      if(getShift(a.staffId,key) === a.type) setShiftValue(a.staffId,key,'');
      releaseManualCell(a.staffId,key);
      cursor.setDate(cursor.getDate()+1);
    }
    state.absences = state.absences.filter(x=>x.id!==id);
    state.pendingReplanFrom = minDateKey([state.pendingReplanFrom,a.start]);
    validation = validateSchedule();
    saveState();
    renderAll();
    setAutoPlanStatus(`Assenza eliminata. Premere “Pianificazione automatica” per ricoprire i turni dal ${formatConflictDate(state.pendingReplanFrom)}.`,validation.month.length > 0);
  }

  function addStaff(){
    const name = prompt('Nome e cognome della nuova persona:');
    if(!name || !name.trim()) return;
    pushUndo(`Aggiungi ${name.trim().toUpperCase()}`);
    const id = `p-${Date.now()}`;
    state.staff.push({
      id,name:name.trim().toUpperCase(),
      can:{M:true,P:true,N:true,GG:true,WKENDFESM:true,WKENDFESP:true,WKENDFESN:true},
      level:'MEDIO',
      note:''
    });
    state.pendingReplanFrom = minDateKey([state.pendingReplanFrom,dateKey(new Date(activeYear,activeMonth,1))]);
    saveState();
    renderAll();
    setAutoPlanStatus('Persona aggiunta. Premere “Pianificazione automatica” per includerla nei turni.');
  }

  function removeStaff(staffId){
    const person = state.staff.find(p => p.id === staffId);
    if(!person) return;

    const confirmed = confirm(
      `Eliminare ${person.name}?\n\nSaranno rimossi anche tutti i suoi turni, le assenze e gli input manuali salvati. Puoi annullare subito con Ctrl+Z.`
    );
    if(!confirmed) return;

    pushUndo(`Elimina ${person.name}`);
    state.staff = state.staff.filter(p => p.id !== staffId);
    state.deletedStaffIds ||= [];
    if(initialStaff.some(p => p.id === staffId) && !state.deletedStaffIds.includes(staffId)){
      state.deletedStaffIds.push(staffId);
    }

    Object.entries(state.schedules || {}).forEach(([mKey,month]) => {
      Object.entries(month || {}).forEach(([dKey,day]) => {
        if(day && Object.prototype.hasOwnProperty.call(day,staffId)) delete day[staffId];
        if(day && Object.keys(day).length === 0) delete month[dKey];
      });
      if(month && Object.keys(month).length === 0) delete state.schedules[mKey];
    });

    Object.keys(state.manualCells || {}).forEach(key => {
      if(key.startsWith(`${staffId}|`)) delete state.manualCells[key];
    });
    pruneShiftLeaders();
    state.absences = (state.absences || []).filter(a => a.staffId !== staffId);
    state.pendingReplanFrom = minDateKey([
      state.pendingReplanFrom,
      dateKey(new Date(activeYear,activeMonth,1))
    ]);

    validation = validateSchedule();
    saveState();
    renderAll();
    setAutoPlanStatus(
      `${person.name} eliminato con tutti i dati collegati. Premere “Pianificazione automatica” per ricalcolare gli altri operatori.`,
      validation.month.length > 0
    );
  }

  // "Pulire tutto" azzera tutto da un mese in poi. Il mese in corso resta
  // protetto insieme allo storico: la cancellazione parte sempre dal mese
  // successivo a quello odierno (oggi agosto 2026 -> parte da settembre
  // 2026), mai prima del pavimento storico già in vigore.
  function firstClearableMonthKey(){
    const today = systemTodayStart();
    const next = new Date(today.getFullYear(),today.getMonth()+1,1);
    const nextKey = monthKey(next.getFullYear(),next.getMonth());
    const floor = editableMonthFloorKey();
    return nextKey > floor ? nextKey : floor;
  }

  function describeMonthKey(key){
    const [year,month] = key.split('-').map(Number);
    return `${MONTHS[month-1]} ${year}`;
  }

  // A differenza della pianificazione automatica, che protegge gli input
  // manuali, questa funzione cancella TUTTO: turni automatici, celle manuali
  // e assenze (richiesta PM 2026-08-06).
  function clearAllFromFirstClearableMonth(){
    const startMonth = firstClearableMonthKey();
    const startKey = `${startMonth}-01`;
    const label = describeMonthKey(startMonth);
    if(!confirm(`Cancellare TUTTI i dati da ${label} in poi?\n\nVengono rimossi sia i turni creati dalla pianificazione automatica sia gli input manuali e le assenze. I mesi precedenti, compreso il mese in corso, restano intatti.\n\nL’operazione è annullabile con Annulla (undo).`)) return;

    pushUndo(`Pulire tutto da ${label}`);
    Object.keys(state.schedules || {}).forEach(key => {
      if(key >= startMonth) delete state.schedules[key];
    });
    Object.keys(state.manualCells || {}).forEach(cell => {
      const dKey = cell.split('|')[1];
      if(dKey && dKey >= startKey) delete state.manualCells[cell];
    });
    // Un'assenza a cavallo del confine non viene persa: resta la parte che
    // appartiene ai mesi protetti e si taglia solo la coda da cancellare.
    state.absences = (state.absences || []).reduce((keep,absence) => {
      if(absence.start >= startKey) return keep;
      if(absence.end >= startKey) absence.end = dateKey(addDays(parseDateKey(startKey),-1));
      keep.push(absence);
      return keep;
    },[]);
    state.pendingReplanFrom = startKey;
    pruneShiftLeaders();
    saveState();
    renderAll();
    setAutoPlanStatus(`Dati cancellati da ${label} in poi. Premere “Pianificazione automatica” dal mese desiderato per ricostruire la pianificazione.`);
  }

  function clearMonth(){
    const key = monthKey(activeYear,activeMonth);
    if(isHistoricalMonth(activeYear,activeMonth)){
      setAutoPlanStatus(historicalMonthMessage(),true);
      return;
    }
    if(!confirm(`Svuotare tutta la pianificazione di ${MONTHS[activeMonth]} ${activeYear}?`)) return;
    pushUndo(`Svuota ${MONTHS[activeMonth]} ${activeYear}`);
    state.schedules[key] = {};
    Object.keys(state.manualCells || {}).forEach(cell => { if(cell.split('|')[1].startsWith(key)) delete state.manualCells[cell]; });
    pruneShiftLeaders();
    state.absences = state.absences.filter(a => !(a.start.slice(0,7)===key || a.end.slice(0,7)===key));
    state.pendingReplanFrom = dateKey(new Date(activeYear,activeMonth,1));
    saveState();
    renderAll();
  }

  function changeMonth(delta){
    const d = new Date(activeYear,activeMonth+delta,1);
    activeYear = d.getFullYear();
    activeMonth = d.getMonth();
    selectedDateKey = dateKey(d);
    if(!Array.from(els.yearSelect.options).some(o=>Number(o.value)===activeYear)){
      populateSelectors();
    }
    renderAll();
  }

  function monthHasAssignments(year,month){
    const monthData = state.schedules[monthKey(year,month)] || {};
    return Object.values(monthData).some(day => Object.values(day || {}).some(Boolean));
  }

  function seedJune2026FromExcel(){
    state.historySeeds ||= {};
    if(state.historySeeds.june2026ExcelFull) return;

    const month = '2026-06';
    state.schedules[month] ||= {};
    const importedIds = new Set(initialStaff.map(p => p.id));

    // Remove only old automatic values in June; genuine manual cells always win.
    for(let day=1;day<=30;day++){
      const dKey = `${month}-${String(day).padStart(2,'0')}`;
      state.schedules[month][dKey] ||= {};
      importedIds.forEach(staffId => {
        if(!isManualCell(staffId,dKey)) delete state.schedules[month][dKey][staffId];
      });
    }

    Object.entries(JUNE_2026_HISTORY).forEach(([dKey,day]) => {
      state.schedules[month][dKey] ||= {};
      Object.entries(day).forEach(([staffId,value]) => {
        if(!isManualCell(staffId,dKey)) state.schedules[month][dKey][staffId] = value;
      });
    });

    state.historySeeds.june2026ExcelFull = {
      source:'Pianificazione.xlsx / pianificazione / entrambi i gruppi',
      imported:true,
      people:21
    };
    saveState();
  }

  function formatShortDate(key){
    return new Intl.DateTimeFormat('it-IT',{day:'2-digit',month:'2-digit',year:'numeric'}).format(parseDateKey(key));
  }

  function escapeHtml(value){
    return String(value).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[ch]));
  }

  // ---- Collegamento all'app Turni-Ferie ----
  let __hooks = {};
  pushUndo = function(label){ if(__hooks.pushUndo) __hooks.pushUndo(label); };
  saveState = function(){ sharedDirty = true; if(__hooks.save) __hooks.save(); };
  setAutoPlanStatus = function(message, warning=false){ if(__hooks.setStatus) __hooks.setStatus(message, warning); };
  updateSaveStatus = function(){};
  updateUndoButton = function(){};
  renderAll = function(){ ensureMonth(); validation = validateSchedule(); if(__hooks.refresh) __hooks.refresh(); };
  refreshPlanningKeepScroll = function(){ validation = validateSchedule(); if(__hooks.refresh) __hooks.refresh(); };
  sharedLoaded = true;

  globalThis.MotoreMontastampi = {
    get state(){ return state; },
    setState(parsed){ state = migrateState(parsed); invalidateMonthRulesCache(); ensureMonth(); return state; },
    setHooks(h){ __hooks = h || {}; },
    setActive(y, m){ activeYear = y; activeMonth = m; selectedDateKey = dateKey(new Date(y, m, 1)); ensureMonth(); },
    seedFor(id){ const q = HISTORICAL_SHIFT_QUOTA_PCT[id]; return {quotaPct: q ? JSON.parse(JSON.stringify(q)) : null}; },
    dateKey, monthKey, daysInMonth, getDayInfo, getShift, isHistoricalMonth, validateSchedule,
    getCountsForDate, targetsFor, runPlanningPass
  };

  // Esecuzione in un Web Worker: riceve lo stato, pianifica e restituisce lo stato aggiornato.
  if(typeof globalThis.importScripts === 'function' && typeof globalThis.postMessage === 'function'){
    globalThis.onmessage = ev => {
      const d = ev.data || {}, msgs = [];
      let err = null;
      try{
        __hooks = {setStatus:(t,w) => msgs.push([t,!!w])};
        state = migrateState(d.state); invalidateMonthRulesCache();
        activeYear = d.y; activeMonth = d.m; selectedDateKey = dateKey(new Date(d.y,d.m,1)); ensureMonth();
        runPlanningPass(!!d.improve, d.start || null);
      }catch(e){ err = String((e && e.message) || e); }
      globalThis.postMessage({state, msgs, err});
    };
  }
})();
