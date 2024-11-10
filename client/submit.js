/*
  from https://github.com/glorious73/submitformtojsonapi/blob/master/src/js/app.js
*/
import FetchService from './fetch.js';

/*-- Objects --*/
const fetchService = new FetchService();
/*-- /Objects --*/

/*--Functions--*/
async function submitForm(e, form, url, buttonId, resetId) {
    // 1. Prevent reloading page
    e.preventDefault();
    // 2. Submit the form
    // 2.1 User Interaction
    const btnSubmit = document.getElementById(buttonId);
    btnSubmit.disabled = true;
    setTimeout(() => btnSubmit.disabled = false, 2000);
    // 2.2 Build body
    try {
        const formData = buildJsonFormData(form);
        // 2.3 Build Headers
        const headers = buildHeaders();
        // 2.4 Request & Response
        const response = await fetchService.performPostHttpRequest(url, headers, formData);
        console.log(response);
        // 2.5 Inform user of result
        if (resetId) {
            if (response) {
                const jsonField = document.getElementById(resetId)
                jsonField.value = ''
                //window.location = `/index.html`;
            } else {
                alert(`An error occured.`);
            }
        }
    } catch (e) {
        document.getElementById('error').innerText = e.toString()
    }
}

function buildHeaders(authorization = null) {
    const headers = {
        "Content-Type": "application/json",
        "Authorization": (authorization) ? authorization : "Bearer TOKEN_MISSING"
    };
    return headers;
}

function buildJsonFormData(form) {
    let jsonFormData = { };
    for(const [name, value] of new FormData(form)) {
        if (name === 'json') {
            return JSON.parse(value);
        } else if (name === 'fetch') {
            const regex = /^fetch\("(.+?)",\s*(\{.*\})\)/s
            const match = regex.exec(value)
            if (match) {
                const toSubmit = JSON.parse(match[2])
                toSubmit.url = match[1]
                return toSubmit
            }
        } else if (name === 'raw') {
            return value
        } else {
            jsonFormData[name] = value;
        }
    }
    return jsonFormData
}
/*--/Functions--*/

/*--Event Listeners--*/
const sampleForm = document.querySelector("#sampleForm")
if (sampleForm) {
    sampleForm.addEventListener("submit", function(e) {
        submitForm(e, this, "http://localhost:3030/download", "btnSubmit", "json")
    })
}
const renamerForm = document.querySelector("#renamerForm")
if (renamerForm) {
    renamerForm.addEventListener("submit", function(e) {
        submitForm(e, this, "http://localhost:3030/cleaner", "btnSubmitClean", "renamer")
    })
}
const nightShadeForm = document.querySelector("#nightShadeForm")
if (nightShadeForm) {
    nightShadeForm.addEventListener("submit", function(e) {
        submitForm(e, this, "http://localhost:3030/nightraw", "btnSubmitNight", "raw")
    })
}
const fetchForm = document.querySelector("#fetchForm")
if (fetchForm) {
    fetchForm.addEventListener("submit", function(e) {
        submitForm(e, this, "http://localhost:3030/fetch", "btnSubmitFetch", "fetch")
    })
}
const novitaForm = document.querySelector("#novitaForm")
if (novitaForm) {
    novitaForm.addEventListener("submit", function(e) {
        submitForm(e, this, "http://localhost:3030/novita/txt2img", "btnSubmit")
    })
}
/*--/Event Listeners--*/
