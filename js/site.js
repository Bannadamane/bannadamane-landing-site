/* ============================================================================
   Bannadamane — Chinnara Chitra Chittara
   Progressive enhancement only: every section reads and works without this file.
   ========================================================================== */
(function () {
  "use strict";

  var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $  = function (s, c) { return (c || document).querySelector(s); };
  var $$ = function (s, c) { return Array.prototype.slice.call((c || document).querySelectorAll(s)); };

  /* ── Header state + floating register button ───────────────────────────── */
  (function () {
    var hdr = $("#hdr"), fab = $("#fab");
    if (!hdr) return;
    var ticking = false;

    function apply() {
      var y = window.scrollY;
      hdr.classList.toggle("is-stuck", y > 40);
      if (fab) fab.classList.toggle("is-shown", y > window.innerHeight * 0.75);
      ticking = false;
    }
    apply();
    window.addEventListener("scroll", function () {
      if (!ticking) { ticking = true; requestAnimationFrame(apply); }
    }, { passive: true });
  })();

  /* ── Mobile drawer ────────────────────────────────────────────────────── */
  (function () {
    var burger = $("#burger"), drawer = $("#drawer");
    if (!burger || !drawer) return;

    function setOpen(open) {
      burger.classList.toggle("is-open", open);
      drawer.classList.toggle("is-open", open);
      burger.setAttribute("aria-expanded", String(open));
      burger.setAttribute("aria-label", open ? "Close menu" : "Open menu");
      document.body.classList.toggle("is-locked", open);
    }

    burger.addEventListener("click", function () {
      setOpen(!drawer.classList.contains("is-open"));
    });
    $$("a", drawer).forEach(function (a) {
      a.addEventListener("click", function () { setOpen(false); });
    });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && drawer.classList.contains("is-open")) {
        setOpen(false);
        burger.focus();
      }
    });
  })();

  /* ── Scroll reveals ───────────────────────────────────────────────────── */
  (function () {
    var items = $$("[data-reveal]");
    if (!items.length) return;

    if (reduced || !("IntersectionObserver" in window)) {
      items.forEach(function (el) { el.classList.add("in"); });
      return;
    }

    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        en.target.classList.add("in");
        io.unobserve(en.target);
      });
    }, { rootMargin: "0px 0px -12% 0px", threshold: 0.15 });

    /* Anything already on screen at load is shown outright. The observer's
       negative rootMargin can otherwise never be satisfied by an element
       sitting in the bottom slice of the first viewport — which would leave
       it invisible for good. */
    items.forEach(function (el) {
      if (el.getBoundingClientRect().top < window.innerHeight) el.classList.add("in");
      else io.observe(el);
    });
  })();

  /* ── The brush mark paints itself on ──────────────────────────────────── */
  (function () {
    var plate = $(".c3-plate");
    if (!plate || reduced || !("IntersectionObserver" in window)) {
      if (plate) plate.classList.add("in");
      return;
    }
    var io = new IntersectionObserver(function (entries) {
      if (!entries[0].isIntersecting) return;
      plate.classList.add("in");
      io.disconnect();
    }, { threshold: 0.3 });
    io.observe(plate);
  })();

  /* ── Count-ups ────────────────────────────────────────────────────────── */
  (function () {
    var nums = $$("[data-count]");
    if (!nums.length) return;

    function run(el) {
      var target = parseInt(el.getAttribute("data-count"), 10) || 0;
      if (reduced) { el.textContent = String(target); return; }

      var dur = 1500, t0 = null;
      function step(ts) {
        if (t0 === null) t0 = ts;
        var p = Math.min((ts - t0) / dur, 1);
        var eased = 1 - Math.pow(1 - p, 3);
        el.textContent = String(Math.round(target * eased));
        if (p < 1) requestAnimationFrame(step);
      }
      requestAnimationFrame(step);
    }

    if (!("IntersectionObserver" in window)) { nums.forEach(run); return; }
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (en) {
        if (!en.isIntersecting) return;
        run(en.target);
        io.unobserve(en.target);
      });
    }, { threshold: 0.5 });
    nums.forEach(function (el) { io.observe(el); });
  })();

  /* ── WET PAINT ─────────────────────────────────────────────────────────
     The cursor is a loaded brush, so it leaves pigment wherever it travels.
     One fixed, page-wide canvas; strokes dry off over a couple of seconds
     so the page never turns to mud, and the loop parks itself when the
     paint is gone. While the hero is on screen an unseen hand scribbles. */
  (function () {
    var cv = $("#paint"), hero = $(".hero");
    if (!cv) return;

    if (reduced) { cv.remove(); return; }

    var ctx = cv.getContext("2d", { alpha: true });
    if (!ctx) { cv.remove(); return; }

    /* The four prospectus swatches, plus gold */
    var PALETTE = [
      [242, 176, 30], [216, 53, 42], [46, 90, 172], [15, 138, 77], [227, 182, 43]
    ];

    var dpr = Math.min(window.devicePixelRatio || 1, 2);
    var w = 0, h = 0;
    var px = 0, py = 0, hasPrev = false;      // brush position
    var ax = 0, ay = 0;                        // autonomous brush
    var phase = Math.random() * 1000;
    var hue = 0, hueDrift = 0;
    /* the idle scribble belongs to the hero, so pages without one (the work
       page) never start it — otherwise it paints unattended forever */
    var running = false, lastPaint = -1e9, heroVisible = !!hero;
    var IDLE_MS = 2600;                        // how long paint takes to dry

    function resize() {
      w = Math.max(1, document.documentElement.clientWidth);
      h = Math.max(1, window.innerHeight);
      cv.width  = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      cv.style.width = w + "px";
      cv.style.height = h + "px";
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      hasPrev = false;
      ax = w * 0.5; ay = h * 0.5;
    }

    function colourAt(t) {
      var n = PALETTE.length;
      var i = Math.floor(t) % n;
      var j = (i + 1) % n;
      var f = t - Math.floor(t);
      var a = PALETTE[i], b = PALETTE[j];
      return [
        Math.round(a[0] + (b[0] - a[0]) * f),
        Math.round(a[1] + (b[1] - a[1]) * f),
        Math.round(a[2] + (b[2] - a[2]) * f)
      ];
    }

    /* One brush stroke: a wide soft bloom of pigment with a denser core.
       Drawn source-over; the canvas itself multiplies onto the paper. */
    function stroke(x0, y0, x1, y1, speed) {
      var c = colourAt(hue);
      var rgb = c[0] + "," + c[1] + "," + c[2];
      var wide = Math.max(16, 54 - speed * 0.9);

      ctx.globalCompositeOperation = "source-over";

      ctx.strokeStyle = "rgba(" + rgb + ",0.05)";
      ctx.lineWidth = wide;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();

      ctx.strokeStyle = "rgba(" + rgb + ",0.11)";
      ctx.lineWidth = wide * 0.34;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.lineTo(x1, y1);
      ctx.stroke();
    }

    function frame() {
      if (!running) return;
      var since = performance.now() - lastPaint;

      /* Dry the paint: pull alpha out rather than layering over the sheet,
         so the paper stays clean where nothing has been painted. */
      ctx.globalCompositeOperation = "destination-out";
      ctx.fillStyle = "rgba(0,0,0,0.05)";
      ctx.fillRect(0, 0, w, h);

      /* An unseen hand keeps the hero alive until someone takes the brush */
      if (heroVisible && since > IDLE_MS) {
        phase += 0.0075;
        var nx = w * (0.5 + 0.31 * Math.sin(phase * 1.9) + 0.11 * Math.sin(phase * 5.3));
        var ny = h * (0.55 + 0.24 * Math.cos(phase * 2.4) + 0.09 * Math.cos(phase * 4.1));
        stroke(ax, ay, nx, ny, 6);
        ax = nx; ay = ny;
        hue += 0.004;
        requestAnimationFrame(frame);
      } else if (since < IDLE_MS) {
        requestAnimationFrame(frame);            /* still drying */
      } else {
        ctx.clearRect(0, 0, w, h);               /* dry — park the loop */
        running = false;
        return;
      }

      hue += hueDrift;
      hueDrift *= 0.9;
    }

    function wake() {
      if (running) return;
      running = true;
      requestAnimationFrame(frame);
    }

    function onMove(e) {
      var x = e.clientX, y = e.clientY;         /* canvas is fixed to the viewport */
      lastPaint = performance.now();

      if (hasPrev) {
        var dx = x - px, dy = y - py;
        var speed = Math.sqrt(dx * dx + dy * dy);
        if (speed > 0.4) {
          stroke(px, py, x, y, speed);
          hueDrift = Math.min(speed, 60) * 0.0012;
        }
      }
      px = x; py = y; hasPrev = true;
      ax = x; ay = y;
      wake();
    }

    resize();

    var rt;
    window.addEventListener("resize", function () {
      clearTimeout(rt);
      rt = setTimeout(resize, 180);
    }, { passive: true });

    window.addEventListener("pointermove", onMove, { passive: true });
    document.addEventListener("pointerleave", function () { hasPrev = false; }, { passive: true });

    /* the idle scribble belongs to the hero; elsewhere the visitor leads */
    if (hero && "IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        heroVisible = entries[0].isIntersecting;
        if (heroVisible) wake();
      }, { threshold: 0 }).observe(hero);
    }

    /* stop burning frames on a hidden tab */
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) running = false;
      else if (heroVisible) wake();
    });

    wake();
  })();

  /* ── The C3 monogram lands ─────────────────────────────────────────────
     It arrives filling the screen and settles into the lockup. Start and
     end are measured at run time, so it lands correctly at any viewport
     size without hard-coded offsets.                                     */
  (function () {
    var c3 = document.querySelector(".hero-c3");
    if (!c3 || reduced) return;

    function play() {
      var r = c3.getBoundingClientRect();
      if (!r.width || !r.height) return;

      var vw = document.documentElement.clientWidth;
      var vh = window.innerHeight;
      var ratio = r.width / r.height;

      /* biggest it can be while still fitting the screen with margin */
      var targetH = Math.min(vh * 0.74, (vw * 0.78) / ratio);
      var scale = Math.max(1, targetH / r.height);
      var dx = vw / 2 - (r.left + r.width / 2);
      var dy = vh / 2 - (r.top + r.height / 2);

      /* Web Animations rather than a CSS transition: with fill "none" the
         element drops back to its stylesheet transform on its own, so an
         interrupted or never-fired end event can't strand it mid-zoom. */
      if (typeof c3.animate !== "function") return;

      c3.style.willChange = "transform";
      var anim = c3.animate(
        [
          { transform: "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px) scale(" + scale.toFixed(3) + ")" },
          { transform: "translate(0px,0px) scale(1)" }
        ],
        /* long and unhurried — a gentler curve than a snappy ease-out, which
           over this duration would spend most of it barely moving */
        { duration: 3500, easing: "cubic-bezier(.30,.10,.20,1)", fill: "none" }
      );

      var clear = function () { c3.style.willChange = ""; };
      if (anim.finished && anim.finished.then) anim.finished.then(clear, clear);
      else anim.onfinish = clear;
    }

    /* the rect is meaningless until the bitmap has decoded */
    if (c3.complete && c3.naturalWidth) requestAnimationFrame(play);
    else c3.addEventListener("load", function () { requestAnimationFrame(play); }, { once: true });
  })();

  /* ── The name turns through its three scripts ──────────────────────────
     English, then Kannada, then Devanagari, five seconds apiece, tumbling
     top over bottom. The swap happens while the mark is edge-on, so the
     change is never seen head-on.                                        */
  (function () {
    var el = $("#heroWordmark"), hero = $(".hero");
    if (!el) return;

    var list = (el.getAttribute("data-wordmarks") || "").split(",")
      .map(function (s) { return s.trim(); })
      .filter(Boolean);
    if (list.length < 2) return;

    var HOLD = 5000;   /* time each script is held */
    var HALF = 340;    /* half a flip */
    var idx = 0, timer = null, busy = false, awake = true;

    /* decode every script up front — swapping to an undecoded image would
       show a blank face at the moment the flip opens out */
    var ready = 0;
    list.forEach(function (src) {
      var im = new Image();
      im.onload = im.onerror = function () { if (++ready === list.length) start(); };
      im.src = src;
    });

    function show(next) {
      el.src = list[next];
      idx = next;
    }

    /* The source swap and the release of `busy` run on timers, never on
       animation.finished — an interrupted or stalled animation would
       otherwise leave the mark stuck mid-turn and stop the cycle for good. */
    function killAnims() {
      if (!el.getAnimations) return;
      el.getAnimations().forEach(function (a) { try { a.cancel(); } catch (e) {} });
    }

    function halfTurn(next, frames, opts) {
      killAnims();                                  /* never stack on a stale turn */
      var a = el.animate(frames.out, opts.out);
      setTimeout(function () {
        show(next);
        var b = el.animate(frames.back, opts.back);
        try { a.cancel(); } catch (e) { /* already gone */ }
        setTimeout(function () {
          /* cancelling drops the mark back to its stylesheet transform, so it
             lands flat even if the animation itself never ran to completion */
          try { b.cancel(); } catch (e) {}
          busy = false;
        }, HALF + 60);
      }, HALF);
    }

    function swapPlain(next) {
      /* reduced motion: a short dissolve rather than a spin */
      halfTurn(next, {
        out:  [{ opacity: 1 }, { opacity: 0 }],
        back: [{ opacity: 0 }, { opacity: 1 }]
      }, {
        out:  { duration: HALF, fill: "forwards" },
        back: { duration: HALF, fill: "none" }
      });
    }

    function flip(next) {
      /* Rotated about the horizontal axis, so the mark tumbles top over
         bottom — the movement travels vertically. fill:forwards holds it
         edge-on across the swap. */
      halfTurn(next, {
        out:  [{ transform: "rotateX(0deg)" }, { transform: "rotateX(90deg)" }],
        back: [{ transform: "rotateX(-90deg)" }, { transform: "rotateX(0deg)" }]
      }, {
        out:  { duration: HALF, easing: "cubic-bezier(.45,0,.9,.5)", fill: "forwards" },
        back: { duration: HALF, easing: "cubic-bezier(.1,.5,.25,1)", fill: "none" }
      });
    }

    function turn() {
      if (busy || !awake) return;
      busy = true;
      var next = (idx + 1) % list.length;
      if (reduced) swapPlain(next); else flip(next);
    }

    function start() {
      clearInterval(timer);
      timer = setInterval(turn, HOLD);
    }
    function stop() { clearInterval(timer); timer = null; }

    /* only turn while the hero is on screen and the tab is in front */
    if (hero && "IntersectionObserver" in window) {
      new IntersectionObserver(function (entries) {
        awake = entries[0].isIntersecting;
        if (awake && ready === list.length) start(); else stop();
      }, { threshold: 0 }).observe(hero);
    }
    document.addEventListener("visibilitychange", function () {
      if (document.hidden) { awake = false; stop(); }
      else { awake = true; if (ready === list.length) start(); }
    });
  })();

  /* ── Hero film: nudge autoplay if the browser declined ────────────────── */
  (function () {
    var v = $(".hero-video");
    if (!v || reduced) return;
    var tryPlay = function () {
      var p = v.play();
      if (p && p.catch) p.catch(function () { /* poster stands in */ });
    };
    tryPlay();
    document.addEventListener("pointerdown", tryPlay, { once: true });
  })();

  /* ── Films load on demand ─────────────────────────────────────────────── */
  (function () {
    $$(".film").forEach(function (btn) {
      btn.addEventListener("click", function () {
        var src = btn.getAttribute("data-video");
        var shell = $(".film-media", btn);
        if (!src || !shell || btn.dataset.loaded) return;

        var v = document.createElement("video");
        v.src = src;
        v.controls = true;
        v.autoplay = true;
        v.playsInline = true;
        v.preload = "auto";
        v.setAttribute("controlsList", "nodownload");

        shell.textContent = "";
        shell.appendChild(v);
        btn.dataset.loaded = "1";
        /* the shell is now a player, not a trigger */
        btn.setAttribute("aria-label", "Video player");
        var p = v.play();
        if (p && p.catch) p.catch(function () {});
      });
    });
  })();

  /* ── Lightbox for the exhibit plates ─────────────────────────────────── */
  (function () {
    var box = $("#lbox"), img = $("#lboxImg"), cap = $("#lboxCap");
    /* anything carrying a full-size source opts in: award plates on the home
       page, programme photographs and press clippings on the work page */
    var plates = $$("[data-full]");
    if (!box || !img || !plates.length) return;

    var idx = 0, lastFocus = null;

    function show(i) {
      idx = (i + plates.length) % plates.length;
      var p = plates[idx];
      img.src = p.getAttribute("data-full") || "";
      img.alt = ($("img", p) || {}).alt || "";
      if (cap) cap.textContent = p.getAttribute("data-cap") || "";
    }

    function open(i) {
      lastFocus = document.activeElement;
      show(i);
      box.classList.add("is-open");
      document.body.classList.add("is-locked");
      $("#lboxClose").focus();
    }

    function close() {
      box.classList.remove("is-open");
      document.body.classList.remove("is-locked");
      if (lastFocus && lastFocus.focus) lastFocus.focus();
    }

    plates.forEach(function (p, i) {
      p.setAttribute("role", "button");
      p.setAttribute("tabindex", "0");
      p.setAttribute("aria-label", "Enlarge: " + (p.getAttribute("data-cap") || "image"));
      p.addEventListener("click", function () { open(i); });
      p.addEventListener("keydown", function (e) {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(i); }
      });
    });

    $("#lboxClose").addEventListener("click", close);
    $("#lboxPrev").addEventListener("click", function () { show(idx - 1); });
    $("#lboxNext").addEventListener("click", function () { show(idx + 1); });
    box.addEventListener("click", function (e) { if (e.target === box) close(); });

    document.addEventListener("keydown", function (e) {
      if (!box.classList.contains("is-open")) return;
      if (e.key === "Escape") close();
      else if (e.key === "ArrowLeft") show(idx - 1);
      else if (e.key === "ArrowRight") show(idx + 1);
      else if (e.key === "Tab") {
        /* keep focus inside the dialog */
        var f = $$("button", box);
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    });
  })();

  /* ── Map loads only when asked ───────────────────────────────────────── */
  (function () {
    var map = $("#map");
    if (!map) return;

    function load() {
      var src = map.getAttribute("data-src");
      if (!src || map.dataset.loaded) return;

      var f = document.createElement("iframe");
      f.src = src;
      f.title = "Map of Bannadamane Samskrutika Vedike, Gadag-Betageri";
      f.loading = "lazy";
      f.referrerPolicy = "no-referrer-when-downgrade";
      f.setAttribute("allowfullscreen", "");

      map.textContent = "";
      map.appendChild(f);
      map.dataset.loaded = "1";
      map.removeAttribute("role");
      map.removeAttribute("tabindex");
      map.removeAttribute("aria-label");
      map.style.cursor = "default";
    }

    map.addEventListener("click", load);
    map.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); load(); }
    });
  })();

})();
