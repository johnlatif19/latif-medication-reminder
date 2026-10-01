(function () {
    "use strict";

    var TOKEN_KEY = "ltaf_admin_token";
    var API_BASE = "";

    // ====== تعريفات الأدوية الثابتة (تطابق ما في Firestore bootstrap) ======
    // ملاحظة: هذه للعرض فقط في حال تأخر الاتصال. المصدر الحقيقي هو /api/medications
    var FALLBACK_MEDICATIONS = [
        { id: "isapril",    name: "إيزابريل",   time: "12:50", dosesPerDay: 1 },
        { id: "pantobi",    name: "بانتوبي",    time: "01:07", dosesPerDay: 1 },
        { id: "concor",     name: "كونكور",     time: "03:57", dosesPerDay: 1 },
        { id: "juspirin",   name: "جوسبرين",    time: "05:08", dosesPerDay: 1 },
        { id: "ator",       name: "اتور",       time: "1:35",  dosesPerDay: 1 },
        { id: "plavix",     name: "بلافيكس",    time: "1:42",  dosesPerDay: 1 },
        { id: "alventern",  name: "ألفينترن",   time: null,    dosesPerDay: 2 },
        { id: "calciton",   name: "كالسيترون",  time: null,    dosesPerDay: 1 }
    ];

    // ====== DOM ======
    var grid = document.getElementById("medicationsGrid");
    var progressSummary = document.getElementById("progressSummary");
    var progressFill = document.getElementById("progressFill");
    var lastUpdateText = document.getElementById("lastUpdateText");
    var eventsList = document.getElementById("eventsList");
    var connectionBadge = document.getElementById("connectionBadge");
    var connectionText = document.getElementById("connectionText");
    var logoutBtn = document.getElementById("logoutBtn");
    var resetBtn = document.getElementById("resetBtn");
    var confirmOverlay = document.getElementById("confirmOverlay");
    var confirmCancel = document.getElementById("confirmCancel");
    var confirmOk = document.getElementById("confirmOk");
    var toastEl = document.getElementById("toast");

    // ====== State ======
    var medicationsById = {};
    var currentSession = null;
    var unsubscribeSession = null;
    var unsubscribeEvents = null;
    var toastTimer = null;
    var isResetting = false;
    var submitInFlight = {};

    // ====== Utils ======
    function getToken() {
        return localStorage.getItem(TOKEN_KEY);
    }

    function authHeaders() {
        return {
            "Content-Type": "application/json",
            "Authorization": "Bearer " + (getToken() || "")
        };
    }

    function redirectToLogin() {
        localStorage.removeItem(TOKEN_KEY);
        window.location.replace("/login.html");
    }

    function todayKey() {
        var d = new Date();
        var y = d.getFullYear();
        var m = String(d.getMonth() + 1).padStart(2, "0");
        var day = String(d.getDate()).padStart(2, "0");
        return y + "-" + m + "-" + day;
    }

    function formatTime(iso) {
        if (!iso) return "—";
        try {
            var d = new Date(iso);
            if (isNaN(d.getTime())) return "—";
            var h = String(d.getHours()).padStart(2, "0");
            var m = String(d.getMinutes()).padStart(2, "0");
            return h + ":" + m;
        } catch (e) {
            return "—";
        }
    }

    function formatDateTime(iso) {
        if (!iso) return "—";
        try {
            var d = new Date(iso);
            if (isNaN(d.getTime())) return "—";
            var h = String(d.getHours()).padStart(2, "0");
            var m = String(d.getMinutes()).padStart(2, "0");
            var day = String(d.getDate()).padStart(2, "0");
            var month = String(d.getMonth() + 1).padStart(2, "0");
            return day + "/" + month + " " + h + ":" + m;
        } catch (e) {
            return "—";
        }
    }

    function showToast(message, type) {
        toastEl.textContent = message;
        toastEl.className = "toast";
        if (type === "error") toastEl.classList.add("toast-error");
        else if (type === "success") toastEl.classList.add("toast-success");
        toastEl.hidden = false;
        if (toastTimer) clearTimeout(toastTimer);
        toastTimer = setTimeout(function () {
            toastEl.hidden = true;
        }, 4200);
    }

    function setConnection(state, text) {
        connectionBadge.setAttribute("data-state", state);
        connectionText.textContent = text;
    }

    // ====== Data computation ======
    function computeStatus(med, sessionMed) {
        if (!sessionMed) return "pending";
        var dosesPerDay = med.dosesPerDay || 1;
        var completed = sessionMed.dosesCompleted || 0;

        if (dosesPerDay === 1) {
            return sessionMed.completed ? "completed" : "pending";
        }

        if (completed <= 0) return "pending";
        if (completed >= dosesPerDay) return "completed";
        return "partially_completed";
    }

    function getSessionMed(session, medId) {
        if (!session || !session.medications) return null;
        return session.medications[medId] || null;
    }

    // ====== Rendering ======
    function renderProgress() {
        var total = 0;
        var taken = 0;

        Object.keys(medicationsById).forEach(function (id) {
            var med = medicationsById[id];
            var dosesPerDay = med.dosesPerDay || 1;
            total += dosesPerDay;

            var sm = getSessionMed(currentSession, id);
            if (sm && typeof sm.dosesCompleted === "number") {
                taken += Math.min(sm.dosesCompleted, dosesPerDay);
            }
        });

        if (total === 0) {
            progressSummary.textContent = "لا توجد أدوية";
            progressFill.style.width = "0%";
            return;
        }

        if (taken === 0) {
            progressSummary.textContent = "لم يتم تسجيل أي جرعات بعد";
        } else if (taken === total) {
            progressSummary.textContent = "تم أخذ جميع الجرعات (" + taken + " من " + total + ")";
        } else {
            progressSummary.textContent = "تم أخذ " + taken + " من " + total;
        }

        var pct = Math.round((taken / total) * 100);
        progressFill.style.width = pct + "%";
    }

    function renderLastUpdate() {
        if (currentSession && currentSession.updatedAt) {
            lastUpdateText.textContent = "آخر تحديث: " + formatDateTime(currentSession.updatedAt);
        } else {
            lastUpdateText.textContent = "آخر تحديث: —";
        }
    }

    function buildMedCard(med) {
        var sm = getSessionMed(currentSession, med.id);
        var status = computeStatus(med, sm);
        var dosesPerDay = med.dosesPerDay || 1;

        var card = document.createElement("div");
        card.className = "med-card";
        card.setAttribute("data-status", status);
        card.setAttribute("data-med-id", med.id);

        // Header
        var header = document.createElement("div");
        header.className = "med-card-header";

        var titleWrap = document.createElement("div");
        var nameEl = document.createElement("div");
        nameEl.className = "med-name";
        nameEl.textContent = med.name;
        titleWrap.appendChild(nameEl);

        if (med.time) {
            var timeEl = document.createElement("span");
            timeEl.className = "med-time";
            timeEl.textContent = "الموعد: " + med.time;
            titleWrap.appendChild(timeEl);
        } else if (dosesPerDay === 2) {
            var noteEl = document.createElement("span");
            noteEl.className = "med-time";
            noteEl.textContent = "مرتين في اليوم";
            titleWrap.appendChild(noteEl);
        }

        var check = document.createElement("div");
        check.className = "med-check";
        check.textContent = status === "completed" ? "✓" : (status === "partially_completed" ? "•" : "");

        header.appendChild(titleWrap);
        header.appendChild(check);
        card.appendChild(header);

        // Body
        var body = document.createElement("div");
        body.className = "med-card-body";

        if (dosesPerDay === 2) {
            var completed = (sm && sm.dosesCompleted) || 0;

            var row1 = document.createElement("div");
            row1.className = "dose-row";
            var l1 = document.createElement("span");
            l1.className = "dose-label";
            l1.textContent = "المرة الأولى";
            var s1 = document.createElement("span");
            s1.className = "dose-status " + (completed >= 1 ? "taken" : "not-taken");
            s1.textContent = completed >= 1 ? "تم أخذها" : "لم تؤخذ";
            row1.appendChild(l1);
            row1.appendChild(s1);
            body.appendChild(row1);

            var row2 = document.createElement("div");
            row2.className = "dose-row";
            var l2 = document.createElement("span");
            l2.className = "dose-label";
            l2.textContent = "المرة الثانية";
            var s2 = document.createElement("span");
            s2.className = "dose-status " + (completed >= 2 ? "taken" : "not-taken");
            s2.textContent = completed >= 2 ? "تم أخذها" : "لم تؤخذ";
            row2.appendChild(l2);
            row2.appendChild(s2);
            body.appendChild(row2);
        }

        card.appendChild(body);

        // Footer
        var footer = document.createElement("div");
        footer.className = "med-card-footer";

        var statusLabel = document.createElement("span");
        statusLabel.className = "med-status-label";
        if (status === "completed") {
            statusLabel.textContent = "تم أخذ الدواء";
        } else if (status === "partially_completed") {
            statusLabel.textContent = "تم أخذ المرة 1 من 2";
        } else {
            statusLabel.textContent = "بانتظار التسجيل";
        }

        var btn = document.createElement("button");
        btn.type = "button";
        btn.className = "take-btn";
        btn.setAttribute("data-action", "take");
        btn.setAttribute("data-med-id", med.id);

        if (status === "completed") {
            btn.textContent = "مكتمل";
            btn.disabled = true;
        } else if (status === "partially_completed") {
            btn.textContent = "تسجيل المرة الثانية";
        } else if (dosesPerDay === 2) {
            btn.textContent = "تسجيل المرة الأولى";
        } else {
            btn.textContent = "تم أخذ الدواء";
        }

        footer.appendChild(statusLabel);
        footer.appendChild(btn);
        card.appendChild(footer);

        if (sm && sm.updatedAt) {
            var ua = document.createElement("span");
            ua.className = "updated-at";
            ua.textContent = "آخر تحديث: " + formatTime(sm.updatedAt);
            card.appendChild(ua);
        }

        return card;
    }

    function renderMedications() {
        var ids = Object.keys(medicationsById);
        grid.innerHTML = "";

        if (ids.length === 0) {
            var empty = document.createElement("div");
            empty.className = "empty-state";
            empty.textContent = "لا توجد أدوية معرّفة";
            grid.appendChild(empty);
            return;
        }

        ids.forEach(function (id) {
            grid.appendChild(buildMedCard(medicationsById[id]));
        });
    }

    function renderEvents(events) {
        eventsList.innerHTML = "";

        if (!events || events.length === 0) {
            var empty = document.createElement("div");
            empty.className = "empty-state";
            empty.textContent = "لا توجد أحداث بعد";
            eventsList.appendChild(empty);
            return;
        }

        events.forEach(function (ev) {
            var item = document.createElement("div");
            item.className = "event-item " + (ev.type === "reset" ? "event-reset" : "event-take");

            var main = document.createElement("div");
            main.className = "event-main";

            var title = document.createElement("div");
            title.className = "event-title";

            var detail = document.createElement("div");
            detail.className = "event-detail";

            if (ev.type === "reset") {
                title.textContent = "تم إعادة تعيين جميع الأدوية";
                detail.textContent = "بواسطة: " + (ev.actor || "المسؤول");
            } else {
                var med = medicationsById[ev.medicationId];
                var medName = med ? med.name : (ev.medicationName || ev.medicationId);
                if (ev.doseNumber && ev.dosesPerDay === 2) {
                    title.textContent = "تم تسجيل أخذ " + medName + " (المرة " + ev.doseNumber + ")";
                } else {
                    title.textContent = "تم تسجيل أخذ " + medName;
                }

                var parts = [];
                if (ev.scheduledTime) parts.push("الموعد: " + ev.scheduledTime);
                if (ev.source === "mobile") parts.push("المصدر: تطبيق الجوال");
                detail.textContent = parts.join("  •  ");
            }

            main.appendChild(title);
            if (detail.textContent) main.appendChild(detail);

            var timeEl = document.createElement("span");
            timeEl.className = "event-time";
            timeEl.textContent = formatDateTime(ev.createdAt);

            item.appendChild(main);
            item.appendChild(timeEl);
            eventsList.appendChild(item);
        });
    }

    function renderAll() {
        renderProgress();
        renderLastUpdate();
        renderMedications();
    }

    // ====== API calls ======
    function loadMedications() {
        return fetch(API_BASE + "/api/medications", {
            headers: authHeaders()
        })
            .then(function (r) {
                if (r.status === 401) {
                    redirectToLogin();
                    throw new Error("unauthorized");
                }
                return r.json();
            })
            .then(function (data) {
                var list = (data && data.medications) || [];
                medicationsById = {};
                list.forEach(function (m) {
                    medicationsById[m.id] = m;
                });

                if (Object.keys(medicationsById).length === 0) {
                    FALLBACK_MEDICATIONS.forEach(function (m) {
                        medicationsById[m.id] = m;
                    });
                }
            })
            .catch(function () {
                // في حال فشل الجلب، استخدم القائمة الاحتياطية للعرض
                if (Object.keys(medicationsById).length === 0) {
                    FALLBACK_MEDICATIONS.forEach(function (m) {
                        medicationsById[m.id] = m;
                    });
                }
            });
    }

    function takeMedication(medId, btn) {
        if (submitInFlight[medId]) return;
        submitInFlight[medId] = true;
        if (btn) btn.disabled = true;

        fetch(API_BASE + "/api/medications/" + encodeURIComponent(medId) + "/take", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({ source: "dashboard" })
        })
            .then(function (r) {
                return r.json().then(function (data) {
                    return { status: r.status, data: data };
                });
            })
            .then(function (result) {
                if (result.status === 401) {
                    redirectToLogin();
                    return;
                }
                if (result.status >= 200 && result.status < 300) {
                    // Firestore listener سيتولى تحديث الواجهة
                    return;
                }
                var msg = (result.data && result.data.error) || "تعذر تسجيل الجرعة";
                showToast(msg, "error");
            })
            .catch(function () {
                showToast("تعذر الاتصال بالخادم", "error");
            })
            .finally(function () {
                submitInFlight[medId] = false;
            });
    }

    function doReset() {
        if (isResetting) return;
        isResetting = true;
        confirmOk.disabled = true;
        confirmCancel.disabled = true;
        confirmOk.textContent = "جارٍ...";

        fetch(API_BASE + "/api/reset", {
            method: "POST",
            headers: authHeaders(),
            body: JSON.stringify({})
        })
            .then(function (r) {
                return r.json().then(function (data) {
                    return { status: r.status, data: data };
                });
            })
            .then(function (result) {
                if (result.status === 401) {
                    redirectToLogin();
                    return;
                }
                if (result.status >= 200 && result.status < 300) {
                    showToast("تم إعادة تعيين جميع الأدوية", "success");
                    closeConfirm();
                } else {
                    var msg = (result.data && result.data.error) || "تعذر إعادة التعيين";
                    showToast(msg, "error");
                }
            })
            .catch(function () {
                showToast("تعذر الاتصال بالخادم", "error");
            })
            .finally(function () {
                isResetting = false;
                confirmOk.disabled = false;
                confirmCancel.disabled = false;
                confirmOk.textContent = "إعادة تعيين";
            });
    }

    // ====== Firestore realtime ======
    function loadFirebaseConfig() {
        return fetch(API_BASE + "/api/firebase-config")
            .then(function (r) { return r.json(); })
            .then(function (data) {
                if (!data || !data.config) throw new Error("no config");
                return data.config;
            });
    }

    function startRealtime() {
        loadFirebaseConfig()
            .then(function (config) {
                if (!firebase.apps.length) {
                    firebase.initializeApp(config);
                }
                var db = firebase.firestore();

                setConnection("connecting", "جارٍ الاتصال");

                var sessionRef = db.collection("dailySessions").doc(todayKey());

                unsubscribeSession = sessionRef.onSnapshot(
                    function (snap) {
                        if (snap.exists) {
                            currentSession = snap.data() || null;
                        } else {
                            currentSession = { medications: {}, updatedAt: null };
                        }
                        setConnection("connected", "متصل");
                        renderAll();
                    },
                    function () {
                        setConnection("offline", "غير متصل");
                    }
                );

                var eventsQuery = db.collection("events")
                    .orderBy("createdAt", "desc")
                    .limit(20);

                unsubscribeEvents = eventsQuery.onSnapshot(
                    function (snap) {
                        var events = [];
                        snap.forEach(function (doc) {
                            var d = doc.data() || {};
                            d.id = doc.id;
                            events.push(d);
                        });
                        renderEvents(events);
                    },
                    function () {
                        // silent
                    }
                );
            })
            .catch(function () {
                setConnection("offline", "غير متصل");
                // حتى لو فشل الـrealtime، نعرض الواجهة من الـAPI
                fetchToday().then(function () {
                    renderAll();
                });
            });
    }

    function fetchToday() {
        return fetch(API_BASE + "/api/medications/today", {
            headers: authHeaders()
        })
            .then(function (r) {
                if (r.status === 401) {
                    redirectToLogin();
                    throw new Error("unauthorized");
                }
                return r.json();
            })
            .then(function (data) {
                currentSession = (data && data.session) || { medications: {}, updatedAt: null };
            })
            .catch(function () {
                currentSession = { medications: {}, updatedAt: null };
            });
    }

    // ====== Confirm dialog ======
    function openConfirm() {
        confirmOverlay.hidden = false;
        confirmOk.focus();
    }

    function closeConfirm() {
        confirmOverlay.hidden = true;
    }

    // ====== Event wiring ======
    grid.addEventListener("click", function (e) {
        var btn = e.target.closest("[data-action='take']");
        if (!btn) return;
        var medId = btn.getAttribute("data-med-id");
        if (!medId) return;
        takeMedication(medId, btn);
    });

    resetBtn.addEventListener("click", openConfirm);
    confirmCancel.addEventListener("click", closeConfirm);
    confirmOk.addEventListener("click", doReset);

    confirmOverlay.addEventListener("click", function (e) {
        if (e.target === confirmOverlay) closeConfirm();
    });

    document.addEventListener("keydown", function (e) {
        if (e.key === "Escape" && !confirmOverlay.hidden) {
            closeConfirm();
        }
    });

    logoutBtn.addEventListener("click", function () {
        if (unsubscribeSession) unsubscribeSession();
        if (unsubscribeEvents) unsubscribeEvents();
        redirectToLogin();
    });

    // ====== Init ======
    function init() {
        var token = getToken();
        if (!token) {
            redirectToLogin();
            return;
        }

        setConnection("connecting", "جارٍ الاتصال");

        loadMedications()
            .then(function () {
                renderAll();
            })
            .then(function () {
                return fetchToday();
            })
            .then(function () {
                renderAll();
                startRealtime();
            })
            .catch(function () {
                renderAll();
                startRealtime();
            });
    }

    init();
})();
