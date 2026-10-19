const analytics = window.LANDING_ANALYTICS;
let redirecting = false;

const SUPABASE_EDGE_URL = "https://fljznpejgywacrnxlggv.supabase.co/functions/v1/get-redirect-url";
const SUPABASE_ANON_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZsanpucGVqZ3l3YWNybnhsZ2d2Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3NjUwODc3ODcsImV4cCI6MjA4MDY2Mzc4N30.oDc46bCj9ZPdUUUvdDTddY5un3A1_lIFUrs_UfFh6N4";
const LANDING_KEY = "camsurflandsk";

const slides = {
    welcome: "./media/slide1.webp",
    email: "./media/slide2.webp",
    age: "./media/slide3.webp"
};

const slideImage = document.getElementById("slideImage");
const emailInput = document.getElementById("emailInput");
const continueBtn = document.getElementById("continueBtn");
const errorMessage = document.getElementById("errorMessage");
const loadingOverlay = document.getElementById("loadingOverlay");
const onboarding = document.getElementById("onboarding");

let activeScreen = "welcome";
let emailIsValid = false;
let cachedOfferUrl = null;
let offerRequest = null;

function isValidEmail(value) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

function setSlide(source) {
    if (slideImage.getAttribute("src") === source) {
        return;
    }

    slideImage.classList.add("is-changing");

    window.setTimeout(() => {
        slideImage.src = source;
        slideImage.classList.remove("is-changing");
    }, 160);
}

function showScreen(name, source) {
    if (name === activeScreen) {
        return;
    }

    setSlide(source);
    activeScreen = name;
    analytics?.enter({ welcome: 1, email: 2, age: 3 }[name]);

    const onEmail = name === "email";
    const onAge = name === "age";
    onboarding.classList.toggle("is-email", onEmail);
    emailInput.hidden = !onEmail;
    continueBtn.textContent = onAge ? "Age verification" : "Continue";
    continueBtn.disabled = onEmail && !emailIsValid;

    if (onEmail) {
        window.setTimeout(() => emailInput.focus({ preventScroll: true }), 280);
    } else {
        emailInput.blur();
    }
}

function getTrackingParams() {
    const params = new URLSearchParams(window.location.search);

    return {
        subid: params.get("subid") || "",
        p7: params.get("p7") || "",
        clickid: params.get("clickid") || "",
        subid2: params.get("subid2") || ""
    };
}

async function getOfferUrl() {
    if (cachedOfferUrl) {
        return cachedOfferUrl;
    }

    if (offerRequest) {
        return offerRequest;
    }

    offerRequest = fetch(SUPABASE_EDGE_URL, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            apikey: SUPABASE_ANON_KEY,
            Authorization: `Bearer ${SUPABASE_ANON_KEY}`
        },
        body: JSON.stringify({ key: LANDING_KEY })
    })
        .then(async (response) => {
            if (!response.ok) {
                throw new Error(`Request failed with status ${response.status}`);
            }

            return response.json();
        })
        .then((data) => {
            if (!data.success || !data.url) {
                throw new Error("Offer URL is unavailable");
            }

            cachedOfferUrl = data.url;
            return cachedOfferUrl;
        })
        .finally(() => {
            offerRequest = null;
        });

    return offerRequest;
}

function encodeEmail(value) {
    const bytes = new TextEncoder().encode(JSON.stringify({ email: value.trim() }));
    let binary = "";

    bytes.forEach((byte) => {
        binary += String.fromCharCode(byte);
    });

    return btoa(binary);
}

function buildFinalUrl(baseUrl, email) {
    const tracking = getTrackingParams();
    let resolvedUrl = baseUrl;

    Object.entries(tracking).forEach(([key, value]) => {
        const encodedValue = encodeURIComponent(value);
        resolvedUrl = resolvedUrl
            .replaceAll(`{${key}}`, encodedValue)
            .replaceAll(`%7B${key}%7D`, encodedValue)
            .replaceAll(`%7b${key}%7d`, encodedValue);
    });

    const finalUrl = new URL(resolvedUrl, window.location.href);
    finalUrl.searchParams.set("myfdata", encodeEmail(email));

    return finalUrl.toString();
}

function setLoading(isLoading) {
    loadingOverlay.hidden = !isLoading;
    continueBtn.disabled = isLoading || (activeScreen === "email" && !emailIsValid);
}

async function handleContinue() {
    if (redirecting) return;
    if (activeScreen === "welcome") {
        analytics?.cta(1);
        showScreen("email", slides.email);
        return;
    }

    if (activeScreen === "email") {
        emailIsValid = isValidEmail(emailInput.value);
        analytics?.observeEmail(emailInput.value);
        if (!emailIsValid) {
            return;
        }

        analytics?.cta(2);
        analytics?.emailSubmitted();
        showScreen("age", slides.age);
        return;
    }

    if (activeScreen !== "age") {
        return;
    }

    redirecting = true;
    analytics?.cta(3);
    errorMessage.textContent = "";
    setLoading(true);

    try {
        const offerUrl = await getOfferUrl();
        const finalUrl = buildFinalUrl(offerUrl, emailInput.value);
        window.setTimeout(() => {
            try {
                analytics?.prepareOutbound();
                window.location.assign(finalUrl);
                analytics?.outboundRedirect();
            } catch {
                analytics?.redirectError();
                restoreAfterOffer();
            }
        }, 350);
    } catch (error) {
        analytics?.redirectError();
        redirecting = false;
        console.error("Unable to resolve offer URL", error);
        errorMessage.textContent = "Connection failed. Please try again.";
        setLoading(false);
    }
}

continueBtn.addEventListener("click", handleContinue);

emailInput.addEventListener("input", () => {
    analytics?.observeEmail(emailInput.value);
    emailIsValid = isValidEmail(emailInput.value);
    continueBtn.disabled = activeScreen === "email" && !emailIsValid;
    errorMessage.textContent = "";
});

emailInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && emailIsValid) {
        event.preventDefault();
        continueBtn.click();
    }
});

[slides.email, slides.age].forEach((source) => {
    const image = new Image();
    image.src = source;
});

getOfferUrl().catch(() => {});

function restoreAfterOffer() {
    redirecting = false;
    setLoading(false);
}
window.addEventListener('pageshow', event => { if (event.persisted) restoreAfterOffer(); });
emailInput.addEventListener('change', () => emailInput.dispatchEvent(new Event('input')));
analytics?.enter(1);
