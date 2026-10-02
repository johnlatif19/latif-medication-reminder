(function () {
    "use strict";

    var TOKEN_KEY = "ltaf_admin_token";

    var form = document.getElementById("loginForm");
    var usernameInput = document.getElementById("username");
    var passwordInput = document.getElementById("password");
    var submitBtn = document.getElementById("submitBtn");
    var errorBox = document.getElementById("errorBox");

    function showError(message) {
        errorBox.textContent = message;
        errorBox.hidden = false;
    }

    function hideError() {
        errorBox.textContent = "";
        errorBox.hidden = true;
    }

    function setLoading(isLoading) {
        submitBtn.disabled = isLoading;
        usernameInput.disabled = isLoading;
        passwordInput.disabled = isLoading;
        submitBtn.textContent = isLoading ? "جارٍ تسجيل الدخول..." : "تسجيل الدخول";
    }

    function isTokenValid(token) {
        if (!token || typeof token !== "string") return false;
        var parts = token.split(".");
        if (parts.length !== 3) return false;
        try {
            var payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/")));
            if (!payload || typeof payload.exp !== "number") return false;
            return payload.exp * 1000 > Date.now();
        } catch (e) {
            return false;
        }
    }

    var existingToken = localStorage.getItem(TOKEN_KEY);
    if (isTokenValid(existingToken)) {
        window.location.replace("/dashbaord");
        return;
    } else if (existingToken) {
        localStorage.removeItem(TOKEN_KEY);
    }

    form.addEventListener("submit", function (event) {
        event.preventDefault();
        hideError();

        var username = usernameInput.value.trim();
        var password = passwordInput.value;

        if (!username || !password) {
            showError("الرجاء إدخال اسم المستخدم وكلمة المرور");
            return;
        }

        setLoading(true);

        fetch("/api/auth/login", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: username,
                password: password
            })
        })
            .then(function (response) {
                return response.json().then(function (data) {
                    return { status: response.status, data: data };
                });
            })
            .then(function (result) {
                if (result.status === 200 && result.data && result.data.token) {
                    localStorage.setItem(TOKEN_KEY, result.data.token);
                    window.location.replace("/dashbaord");
                    return;
                }

                var msg = "تعذر تسجيل الدخول";
                if (result.data && typeof result.data.error === "string") {
                    msg = result.data.error;
                } else if (result.status === 401) {
                    msg = "اسم المستخدم أو كلمة المرور غير صحيحة";
                } else if (result.status === 429) {
                    msg = "محاولات كثيرة، حاول لاحقًا";
                }

                showError(msg);
                setLoading(false);
                passwordInput.value = "";
                passwordInput.focus();
            })
            .catch(function () {
                showError("تعذر الاتصال بالخادم، تحقق من الشبكة");
                setLoading(false);
            });
    });

    usernameInput.focus();
})();
