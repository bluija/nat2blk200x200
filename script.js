import {
    blockRandomization,
    finalizeBlockRandomization,
    firebaseUserId,
    writeRealtimeDatabase,
    writeURLParameters,
} from "./firebasepsych.js";

console.log(firebaseUserId);

/*
data saved as FirebaseID /
1. pid: Prolific URL parameters
2. exp: experiment-wide data
3. trial: trial data
*/

const debug = false;

// constants
const cat1Clr = "warning";
const cat2Clr = "info";

const numTrial = 200;
const blockSize = Math.round(numTrial / 4);

const studyId = "nat2blk200x200v2";
const dbPath = studyId + "/participantData/" + firebaseUserId + "/";

const redirectURL = "https://app.prolific.com/submissions/complete?cc=C1P1YP97";
const expData = {}; // experiment-wide data

const allTrialData = [] // all trial data as backup
const errorTrialIdx = [] // error trial numbers

// variables
let trialData; // trial-level data
let aiData;

let isIntro;
let introTimer;

let curTrial = 1;
let curScore = 0;

let cat1Score = 0;
let cat2Score = 0;

let curTrialPer = 0;
let curScorePer = 0;

let warnOnLeave = false;
let submitting = false;

let consentRemaining = 5;
let dataReady = false;

// consent
const consent = document.querySelector(".consent");
const consentCheckbox = document.querySelector(".consentCheckbox");
const startButton = document.querySelector(".startButton");

// experiment
const experiment = document.querySelector(".experiment");
const trial = document.querySelector(".trial");
const score = document.querySelector(".score");
const question = document.querySelector(".question");

const aiForm = document.querySelector(".aiForm");

const humanForm = document.querySelector(".humanForm");
const humanField = document.querySelector(".humanField");
const humanSubmit = document.querySelector(".humanSubmit");

const imageDisplay = document.querySelector(".imageDisplay");
const stimuliDisplay = document.querySelector(".stimuliDisplay");
const questionCat = document.querySelector(".questionCat");
const questionCnf = document.querySelector(".questionCnf");

// complete
const complete = document.querySelector(".complete");

const commentDisplay = document.querySelector(".commentDisplay");
const commentField = document.getElementById("commentField");
const commentSubmit = document.querySelector(".commentSubmit");

const redirectDisplay = document.querySelector(".redirectDisplay");
const redirectButton = document.querySelector(".redirectButton");

const catEmj = document.querySelectorAll(".catEmj");
const mainDisplay = document.querySelector(".mainDisplay");

// helpers
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const timePassed = () => Math.round(performance.now());

const writeRetry = async (path, data, tries = 3, timeoutMs = 10000) => {
    for (let attempt = 1; attempt <= tries; attempt++) {
        let timer;
        try {
            await Promise.race([
                writeRealtimeDatabase(path, data),
                new Promise((_, reject) => {
                    timer = setTimeout(() => reject(new Error("timeout")), timeoutMs);
                }),
            ]);
            return true;
        } catch (error) {
            console.error(`Error writing to ${path} (attempt ${attempt}):`, error);
            if (attempt < tries) await sleep(1000 * attempt);
        } finally {
            clearTimeout(timer);
        }
    }
    return false;
};

function countdownNext(seconds = 2) {
    const btn = document.querySelector(".introjs-nextbutton");
    if (!btn) return;

    clearInterval(introTimer);
    let remaining = seconds;

    const setLocked = (locked) => {
        btn.classList.toggle("introjs-disabled", locked);
        btn.style.pointerEvents = locked ? "none" : "auto";
        btn.setAttribute("tabindex", locked ? "-1" : "0");
    };

    setLocked(true);
    btn.textContent = `Next (${remaining}s)`;

    introTimer = setInterval(() => {
        btn.textContent = --remaining > 0 ? `Next (${remaining}s)` : "Next";
        if (remaining <= 0) {
            clearInterval(introTimer);
            setLocked(false);
        }
    }, 1000);
}

const getData = async (dataPath) => {
    try {
        const response = await fetch(dataPath);
        if (!response.ok) {
            throw new Error(`Response status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error(error.message);
    }
};

const displayTrial = (cat) => {
    if (cat === "Plants") {
        catEmj.forEach((emj) => (emj.textContent = "🌱"));
        mainDisplay.classList.replace(`text-bg-${cat2Clr}`, `text-bg-${cat1Clr}`);

        imageDisplay.src =
            "https://upload.wikimedia.org/wikipedia/commons/thumb/e/e6/Rosa_rubiginosa_1.jpg/330px-Rosa_rubiginosa_1.jpg";
        questionCat.textContent = `Rosa rubiginosa`;
    } else {
        console.assert(cat === "Fungi");

        catEmj.forEach((emj) => (emj.textContent = "🍄"));
        mainDisplay.classList.replace(`text-bg-${cat1Clr}`, `text-bg-${cat2Clr}`);

        imageDisplay.src =
            "https://upload.wikimedia.org/wikipedia/commons/thumb/3/34/Boletus_edulis_IT.jpg/500px-Boletus_edulis_IT.jpg";
        questionCat.textContent = `Boletus edulis`;
    }

    document.getElementById(`ai50`).checked = true;
};

const resetTrial = async () => {
    trialData = structuredClone(aiData[curTrial - 1]);
    trialData.startTime = timePassed();

    trialData.trial = curTrial;
    trialData.aiCnf = Math.round(trialData.aiCnf * 10) * 10;

    aiForm.reset();
    humanForm.reset();

    humanField.disabled = true;
    submitting = false

    if (trialData.cat === "Plants") {
        catEmj.forEach((emj) => (emj.textContent = "🌱"));
        mainDisplay.classList.replace(`text-bg-${cat2Clr}`, `text-bg-${cat1Clr}`);
    } else {
        console.assert(trialData.cat === "Fungi");

        catEmj.forEach((emj) => (emj.textContent = "🍄"));
        mainDisplay.classList.replace(`text-bg-${cat1Clr}`, `text-bg-${cat2Clr}`);
    }

    questionCat.textContent = "(Thinking...)";
    imageDisplay.src = trialData.path;

    await sleep(2000);

    questionCat.textContent = trialData.aiAns;
    document.getElementById(`ai${trialData.aiCnf}`).checked = true;

    humanField.disabled = false;
    humanSubmit.disabled = true;

    if ((curTrial - 1) % blockSize === 0) {
        const blockEmj = blockIcon[(curTrial - 1) / blockSize];

        let steps = [
            ...(blocked ? [
                    {
                        title: `${blockEmj} Block`,
                        intro: `<p>You are now starting a ${blockEmj} block with ${blockSize} trials.</p>`,
                    },
                ]
                : [
                    {
                        title: "Progress",
                        intro: `<p>You have completed ${curTrial - 1} trials, with ${numTrial - curTrial + 1} remaining.</p>`,
                    },
                ]),
            {
                title: "Reminder",
                intro:
                    "<p>The AI's accuracy and confidence may differ between Plants 🌱 and Fungi 🍄.</p>",
            },
        ];

        introJs()
            .setOptions({
                exitOnEsc: false,
                exitOnOverlayClick: false,
                showBullets: debug,
                keyboardNavigation: debug,
                steps,
            })
            .onafterchange(() => countdownNext())
            .start();
    }
};

// onboarding
function updateStartButton() {
    startButton.disabled = consentRemaining > 0 || !consentCheckbox.checked || !dataReady;
    startButton.textContent = consentRemaining > 0 ? `Start (${consentRemaining}s)`
        : dataReady ? "Start" : "Loading...";
}

updateStartButton();
consentCheckbox.onchange = updateStartButton;

const consentTimer = setInterval(() => {
    consentRemaining--;
    if (consentRemaining <= 0) clearInterval(consentTimer);
    updateStartButton();
}, 1000);


startButton.onclick = async () => {
    warnOnLeave = true;
    expData.startTime = Date.now();

    consent.classList.add("d-none");
    experiment.classList.remove("d-none");

    isIntro = true;
    displayTrial("Plants");

    let intro = introJs();
    const stimulusIntro =
        blocked ? `<p>There are two image types: Plants 🌱 and Fungi 🍄.</p>` +
            `<p>Images are presented in blocks of ${blockSize}: ${blockIcon.join(", ")}.</p>`
            : "<p>There are two image types: Plants 🌱 and Fungi 🍄.</p>" +
            `<p>Images are presented alternately: ${blockIcon.join(", ")}...</p>`;

    let steps = [
        {
            title: "Welcome",
            intro:
                "<p>We study how humans verify AI.</p>" +
                "<p>Your results will help design safer AI.</p>",
        },
        {
            title: "Important",
            intro:
                "<p><strong>Do not use any external AI</strong> — use only the AI provided in the experiment.</p>",
        },
        {
            title: "Objective",
            element: question,
            intro:
                "<p>An AI will identify the species in the image shown.</p>" +
                "<p>Your job: decide whether the AI is <strong>correct</strong> or <strong>wrong</strong>.</p>",
        },
        {
            title: "Stimulus",
            element: stimuliDisplay,
            intro: stimulusIntro,
        },
        {
            title: "Plants 🌱",
            element: mainDisplay,
            intro: `<p>Plant 🌱 images have a <span class="badge text-bg-${cat1Clr}">yellow</span> background.</p>`,
        },
        {
            title: "Fungi 🍄",
            element: mainDisplay,
            intro: `<p>Fungi 🍄 images have a <span class="badge text-bg-${cat2Clr}">cyan</span> background.</p>`,
        },
        {
            title: "AI's Response",
            element: aiForm,
            intro:
                "<p>The AI provides its <strong>predicted species</strong> and <strong>confidence</strong> per image.</p>" +
                "<p>Use both to judge the AI.</p>",
        },
        {
            title: "AI's Confidence",
            element: questionCnf,
            intro:
                "<p><strong>0%</strong> = purely guessing; <strong>100%</strong> = totally certain.</p>" +
                "<p>Lower confidence means the AI is less certain about its prediction.</p>",
        },
        {
            title: "AI's Limitations",
            intro:
                "<p>The AI is trained on lab images and may often be wrong.</p>" +
                "<p>Its accuracy and confidence may also differ between Plants 🌱 and Fungi 🍄.</p>",
        },
        {
            title: "Judge",
            element: humanForm,
            intro:
                "<p>Select <strong>Correct</strong> or <strong>Wrong</strong>, then click Submit.</p>",
        },
        {
            title: "Bonus",
            intro:
                "<p>Every correct judgment = 1 point = <strong>$0.01 bonus</strong>.</p>",
        },
        {
            title: "Progress",
            element: trial,
            intro: "<p>Top left: current trial / total trials.</p>",
        },
        {
            title: "Score",
            element: score,
            intro: "<p>Top right: correct trials / completed trials.</p>",
        },
        {
            title: "Start",
            intro: `<p>You're ready! Earn up to <strong>$${(numTrial * 0.01).toFixed(2)}</strong> bonus.</p>`,
        },
    ];
    intro
        .setOptions({
            exitOnEsc: false,
            exitOnOverlayClick: false,
            showBullets: debug,
            keyboardNavigation: debug,
            steps,
        })
        .onbeforechange(() => {
            let step = intro.currentStep();
            let chxIdx = 4;

            if (step === chxIdx || step === chxIdx + 2) {
                displayTrial("Plants");
            } else if (step === chxIdx + 1) {
                displayTrial("Fungi");
            }
        })
        .oncomplete(() => {
            isIntro = false;
            resetTrial();
        })
        .onafterchange(() => countdownNext())
        .start();
};

humanForm.oninput = () => {
    if (!isIntro) {
        humanSubmit.disabled = !humanForm.checkValidity();
    }
};


humanForm.onsubmit = async (event) => {
    event.preventDefault();

    if (submitting) return;
    submitting = true;

    humanSubmit.disabled = true;
    trialData.humanTime = timePassed();

    let humanAns = document.querySelector('input[name="humanAns"]:checked').value;
    trialData.humanAns = humanAns;

    let title;
    let descr;

    let aiCor = trialData.aiCor;
    let aiCorTxt = aiCor ? "correct" : "wrong";

    if ((aiCor && humanAns === "yes") || (!aiCor && humanAns === "no")) {
        curScore++;
        trialData.correct = true;

        if (trialData.cat === "Plants") cat1Score++;
        else cat2Score++;

        title = "&#x2714; You're Correct!";
        descr = `<p>The AI was <strong>${aiCorTxt}</strong>. </p>
<p>Score +1! &#127881; Total bonus: <strong>$${(curScore / 100).toFixed(2)}</strong></p>`;
    } else {
        trialData.correct = false;

        title = "&#x2718; You're Wrong.";
        descr = `<p>The AI was <strong>${aiCorTxt}</strong>.</p>`;
    }

    curScorePer = Math.round((curScore / curTrial) * 100);
    score.textContent = `Score: ${curScore}/${curTrial} (${curScorePer}%)`;

    trialData.endTime = timePassed();

    if (debug) {
        console.log(trialData);
    }

    allTrialData.push(trialData);

    humanSubmit.textContent = "Saving...";
    humanField.disabled = true;

    const ok = await writeRetry(dbPath + "/trial/" + curTrial, trialData);
    humanSubmit.textContent = "Submit";

    if (!ok) {
        errorTrialIdx.push(curTrial);
        console.error("Failed to write trial data");
    }

    introJs()
        .setOptions({
            exitOnEsc: false,
            exitOnOverlayClick: false,
            showBullets: debug,
            keyboardNavigation: debug,
            steps: [
                {
                    title: title,
                    intro: descr,
                },
            ],
        })
        .oncomplete(async () => {
            curTrial++;
            curTrialPer = Math.round((curTrial / numTrial) * 100);

            trial.textContent = `Trial: ${curTrial}/${numTrial} (${curTrialPer}%)`;

            if (curTrial <= numTrial) {
                resetTrial();
            } else {
                experiment.classList.add("d-none");
                complete.classList.remove("d-none");

                await writeRetry(dbPath + "/trialBackup", allTrialData);

                expData.score = curScore;

                expData.cat1Score = cat1Score;
                expData.cat2Score = cat2Score;
            }
        })
        .onafterchange(() => countdownNext())
        .start();
};

commentSubmit.onclick = async () => {
    commentSubmit.disabled = true;
    commentField.disabled = true;

    expData.comment = commentField.value;
    expData.endTime = Date.now();

    expData.errorTrialIdx = errorTrialIdx;
    await writeRetry(dbPath + "/exp", expData);

    try {
        await finalizeBlockRandomization(studyId, "nat");
    } catch (error) {
        console.error(error);
    }

    warnOnLeave = false;

    commentDisplay.classList.add("d-none");
    redirectDisplay.classList.remove("d-none");

    await sleep(2000);
    window.location.replace(redirectURL);
};

redirectButton.onclick = () => {
    window.location.replace(redirectURL);
};

// initialize
writeURLParameters(dbPath + "/pid");

trial.textContent = `Trial: ${curTrial}/${numTrial} (${curTrialPer}%)`;
score.textContent = `Score: 0/0 (0%)`;

const condition = await blockRandomization(studyId, "nat", 8, 200, 1); // 0-based
expData.condition = condition[0];

// checking boolean values on 2x2x2
// overconfidence on Plants and underconfidence on Fungi
const overPlant = Boolean(expData.condition & 1);

const jsonPlant = overPlant ? `overPlants.json` : `underPlants.json`;
const jsonFungi = overPlant ? `underFungi.json` : `overFungi.json`;

// 1st image is Plant
const plant1st = Boolean(expData.condition & 2);

const data1Path = plant1st ? jsonPlant : jsonFungi;
const data2Path = plant1st ? jsonFungi : jsonPlant;

const blockIcon = plant1st ? ["Plants 🌱", "Fungi 🍄", "Plants 🌱", "Fungi 🍄"] :
    ["Fungi 🍄", "Plants 🌱", "Fungi 🍄", "Plants 🌱"]

// blocked or interleaved
const blocked = Boolean(expData.condition & 4);

let [data1, data2] = await Promise.all([
    getData(data1Path),
    getData(data2Path),
]);

data1 = _.sampleSize(data1, blockSize * 2);
data2 = _.sampleSize(data2, blockSize * 2);

if (blocked) {
    aiData = [
        ...data1.slice(0, blockSize),
        ...data2.slice(0, blockSize),
        ...data1.slice(blockSize),
        ...data2.slice(blockSize),
    ];
} else {
    // interleaved
    aiData = data1.flatMap((ele, idx) => [ele, data2[idx]]);
}

if (aiData.length === numTrial) {
    dataReady = true;
    updateStartButton();
} else {
    startButton.textContent = "Error loading data — please refresh";
}

Object.assign(expData, {overPlant, plant1st, blocked})
await writeRetry(dbPath + "/exp", expData);


window.addEventListener("beforeunload", (event) => {
    if (warnOnLeave) {
        event.preventDefault();
        event.returnValue = ""; // compatibility
    }
});

if (debug) {
    console.log(expData);

    console.log(data1Path);
    console.log(data2Path);

    console.log(aiData);
}




