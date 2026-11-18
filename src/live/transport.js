// Transports for the online lesson. Both have the same shape:
//   open({ role, meta, onCoach(evt, payload), onStudent(evt, payload), onPresence(list), onStatus(status) })
//   sendCoach(evt, payload)    — coach only ('c' channel)
//   sendStudent(evt, payload)  — students ('s' channel; only the coach receives it)
//   close()
// status: 'connecting' | 'online' | 'offline' | 'denied'. 'online' is reported again after every
// reconnection, so the session can re-synchronise.

/**
 * Supabase Realtime: two PRIVATE channels per lesson. Who may join, read and send is decided by the
 * policies on realtime.messages (migration 20261118000001); the client cannot widen it.
 * supabase-js rejoins channels by itself after a network break.
 */
export function createSupabaseTransport(client, lessonId) {
  var chC = null, chS = null, h = null, role = 's', meta = null, closed = false;
  var stC = '', stS = '';

  var deniedHint = false;
  function report() {
    if (closed || !h) return;
    if (stC === 'SUBSCRIBED' && stS === 'SUBSCRIBED') h.onStatus('online');
    else if (deniedHint) h.onStatus('denied');
    else if ([stC, stS].some(function (s) { return s === 'CHANNEL_ERROR' || s === 'TIMED_OUT' || s === 'CLOSED'; })) h.onStatus('offline');
    else h.onStatus('connecting');
  }
  function presenceList() {
    var st = chS ? chS.presenceState() : {}, out = [];
    Object.keys(st).forEach(function (k) { (st[k] || []).forEach(function (m) { out.push(m); }); });
    return out;
  }

  return {
    kind: 'supabase',
    open: async function (o) {
      h = o; role = o.role; meta = o.meta;
      try { if (client.realtime && client.realtime.setAuth) await client.realtime.setAuth(); } catch (e) { /* the token is set by supabase-js anyway */ }
      var base = 'lesson:' + lessonId;
      chC = client.channel(base + ':c', { config: { private: true, broadcast: { self: false, ack: false } } });
      chC.on('broadcast', { event: '*' }, function (m) { if (!closed && role !== 'c') h.onCoach(m.event, m.payload); });
      chS = client.channel(base + ':s', { config: { private: true, broadcast: { self: false, ack: false }, presence: { key: (meta && meta.k) || '' } } });
      chS.on('broadcast', { event: '*' }, function (m) { if (!closed && role === 'c') h.onStudent(m.event, m.payload); });
      chS.on('presence', { event: 'sync' }, function () { if (!closed) h.onPresence(presenceList()); });
      h.onStatus('connecting');
      chC.subscribe(function (s, err) { stC = s; if (err && /unauthori[sz]ed|denied|policy|permission/i.test(String(err.message || err))) deniedHint = true; report(); });
      chS.subscribe(function (s, err) {
        stS = s;
        if (err && /unauthori[sz]ed|denied|policy|permission/i.test(String(err.message || err))) deniedHint = true;
        if (s === 'SUBSCRIBED') chS.track(meta).catch(function () {});
        report();
      });
    },
    sendCoach: function (evt, payload) { if (chC && !closed) chC.send({ type: 'broadcast', event: evt, payload: payload }).catch(function () {}); },
    sendStudent: function (evt, payload) { if (chS && !closed) chS.send({ type: 'broadcast', event: evt, payload: payload }).catch(function () {}); },
    close: function () {
      closed = true;
      [chC, chS].forEach(function (ch) { if (ch) { try { client.removeChannel(ch); } catch (e) { /* already gone */ } } });
      chC = chS = null;
    }
  };
}

/**
 * Transport over a message bus: { post(msg), subscribe(cb) -> unsubscribe }. Used by the unit tests
 * (createMemoryBus) and by the end-to-end tests (the test runner relays messages between two
 * browsers). Presence is emulated with join/here/leave messages.
 */
export function createBusTransport(bus) {
  var h = null, me = null, role = 's', closed = false, unsub = null, peers = {};
  function presence() { h.onPresence(Object.keys(peers).map(function (k) { return peers[k]; }).concat([me.meta])); }
  function onMsg(msg) {
    if (closed || !msg || msg.from === me.id) return;
    if (msg.kind === 'presence') {
      if (msg.op === 'leave') delete peers[msg.from]; else peers[msg.from] = msg.meta;
      if (msg.op === 'join') bus.post({ kind: 'presence', op: 'here', from: me.id, meta: me.meta, role: role });
      presence();
      return;
    }
    if (msg.ch === 'c' && role !== 'c') h.onCoach(msg.evt, msg.payload);
    else if (msg.ch === 's' && role === 'c') h.onStudent(msg.evt, msg.payload);
  }
  return {
    kind: 'bus',
    open: async function (o) {
      h = o; role = o.role; me = { id: Math.random().toString(36).slice(2), meta: o.meta };
      h.onStatus('connecting');
      unsub = bus.subscribe(onMsg);
      bus.post({ kind: 'presence', op: 'join', from: me.id, meta: me.meta, role: role });
      h.onStatus('online');
      presence();
    },
    sendCoach: function (evt, payload) { if (!closed) bus.post({ ch: 'c', evt: evt, payload: JSON.parse(JSON.stringify(payload)), from: me.id, role: role }); },
    sendStudent: function (evt, payload) { if (!closed) bus.post({ ch: 's', evt: evt, payload: JSON.parse(JSON.stringify(payload)), from: me.id, role: role }); },
    // tests: simulate a network break and a reconnection
    drop: function () { if (unsub) unsub(); unsub = null; h.onStatus('offline'); },
    restore: function () { unsub = bus.subscribe(onMsg); bus.post({ kind: 'presence', op: 'join', from: me.id, meta: me.meta, role: role }); h.onStatus('online'); },
    close: function () {
      if (closed) return;
      bus.post({ kind: 'presence', op: 'leave', from: me.id, role: role });
      closed = true;
      if (unsub) unsub();
    }
  };
}

/**
 * In-memory bus for several transports in one process. Like the Realtime policies, it drops
 * messages on the coach's channel that were not sent by the coach.
 */
export function createMemoryBus() {
  var subs = [];
  return {
    post: function (msg) {
      if (msg.ch === 'c' && msg.role !== 'c') return; // not allowed by the policies
      subs.slice().forEach(function (cb) { cb(msg); });
    },
    subscribe: function (cb) { subs.push(cb); return function () { subs = subs.filter(function (x) { return x !== cb; }); }; }
  };
}
