const carCanvas = document.getElementById("carCanvas");
carCanvas.width = 200;

const networkCanvas = document.getElementById("networkCanvas");
networkCanvas.width = 300;

const carCtx = carCanvas.getContext("2d");
const networkCtx = networkCanvas.getContext("2d");

const road = new Road(carCanvas.width / 2, carCanvas.width * 0.9);

const N = 100;                       // AI population size
const START_Y = 100;                 // where every car starts
const MAX_GEN_STEPS = 3600;          // a generation lasts at most this many steps (~60s at 60fps)
const TRAFFIC_SPEED = 2;

// Anti-crawling rule: traffic spawns ahead and drives at TRAFFIC_SPEED, so a car that just crawls
// slower than that could never be hit and would "win" by doing nothing. Every PROGRESS_WINDOW steps,
// a car must have advanced at least MIN_SPEED * PROGRESS_WINDOW pixels or it is eliminated.
// (It also weeds out cars that spin in circles, sit still or reverse.)

const PROGRESS_WINDOW = 120;
const MIN_SPEED = TRAFFIC_SPEED + 0.3;
const CHECKPOINT_STEPS = 600;        // save the best brain mid-generation this often (if it beats the record)
const RECORD_DECAY = 0.97;           // the record shrinks a bit every generation nobody beats it (see notes)
const RAMP_DISTANCE = 20000;         // distance at which traffic reaches full difficulty
const SPEED_STEPS = [1, 4, 16];      // AI mode: simulation steps per frame (fast-forward)
const SHOW_SENSORS_IN_HUMAN_MODE = false;

// "AI" or "HUMAN". Remembered between reloads. Toggle with the button or the M key,

let mode = localStorage.getItem("mode") === "HUMAN" ? "HUMAN" : "AI";
let speedIndex = 0;

const spawner = new TrafficSpawner(road, { speed: TRAFFIC_SPEED });
const aiCars = generateCars(N);
let player = null;                   // created the first time HUMAN mode starts
let focusCar = aiCars[0];            // the car the camera follows

let generation = Number(localStorage.getItem("generation")) || 1;
let record = Number(localStorage.getItem("bestFitness")) || 0;
let genStep = 0;
let humanBest = Number(localStorage.getItem("humanBest")) || 0;

let modeBtn, speedBtn;

buildControls();
startMode();
requestAnimationFrame(animate);

function animate(time) {
    const steps = mode == "AI" ? SPEED_STEPS[speedIndex] : 1;
    for (let i = 0; i < steps; i++) {
        step();
    }
    draw(time);
    requestAnimationFrame(animate);
}

function step() {
    if (mode == "AI") {
        stepAI();
    } else {
        stepHuman();
    }
}

// Advances traffic and the given cars by one tick. Returns false if nobody is alive.
function stepWorld(cars) {
    let leader = null;
    let rearY = -Infinity;
    for (const c of cars) {
        if (c.damaged) continue;
        if (!leader || c.y < leader.y) leader = c;
        if (c.y > rearY) rearY = c.y;
    }
    if (!leader) return false;
    focusCar = leader;

    const difficulty = Math.min(1, (START_Y - leader.y) / RAMP_DISTANCE);
    spawner.update(leader.y, rearY, difficulty);

    for (const c of cars) {
        c.update(road.borders, spawner.cars);
    }
    return true;
}

function distanceOf(car) {
    return Math.max(0, START_Y - car.y);
}

// Human-mode
function stepHuman() {
    if (player.damaged) return;              // game over: wait for restart

    stepWorld([player]);

    if (player.damaged) {                    // just crashed
        const score = Math.floor(distanceOf(player));
        if (score > humanBest) {
            humanBest = score;
            localStorage.setItem("humanBest", humanBest);
        }
    }
}

function restartHuman() {
    resetCar(player);
    spawner.reset(START_Y);
    focusCar = player;
}

// AI-mode
function stepAI() {
    const running = stepWorld(aiCars);
    genStep++;

    for (const c of aiCars) {
        const d = distanceOf(c);
        if (d > c.fitness) c.fitness = d;    // fitness = furthest distance reached (frozen once damaged)
    }

    if (genStep % PROGRESS_WINDOW == 0) {
        for (const c of aiCars) {
            if (c.damaged) continue;
            if (c.fitness - c.windowStart < MIN_SPEED * PROGRESS_WINDOW) {
                c.damaged = true;
            }
            c.windowStart = c.fitness;
        }
    }

    if (genStep % CHECKPOINT_STEPS == 0) {
        checkpoint();
    }
    if (!running || genStep >= MAX_GEN_STEPS) {
        endGeneration();
    }
}

function startGeneration() {
    spawner.reset(START_Y);
    const parent = loadBrain();              // best brain saved so far (or null)

    aiCars.forEach((car, i) => {
        resetCar(car);
        if (parent) {
            car.brain = cloneBrain(parent);
            if (i > 0) {                     // car 0 is the untouched elite
                NeuralNetwork.mutate(car.brain, mutationFor(i));
            }
        } else {
            car.brain = new NeuralNetwork([car.sensor.rayCount, 6, 4]);
        }
    });

    genStep = 0;
    focusCar = aiCars[0];
}

function endGeneration() {
    const best = bestOfGeneration();

    if (best.fitness > 0 && best.fitness >= record) {
        record = best.fitness;
        saveBrain(best.brain);
    } else {
        record *= RECORD_DECAY;
    }

    generation++;
    persistStats();
    startGeneration();
}

function checkpoint() {
    const best = bestOfGeneration();
    if (best.fitness > record) {
        record = best.fitness;
        saveBrain(best.brain);
        persistStats();
    }
}

function bestOfGeneration() {
    return aiCars.reduce((a, b) => (b.fitness > a.fitness ? b : a));
}

// Small tweaks for most cars, bigger ones for a few, and a handful of brand-new random brains.
function mutationFor(i) {
    const r = i / N;
    if (r < 0.3) return 0.05;
    if (r < 0.7) return 0.15;
    if (r < 0.95) return 0.3;
    return 1;
}

function loadBrain() {
    const s = localStorage.getItem("bestBrain");
    return s ? JSON.parse(s) : null;
}

function saveBrain(brain) {
    localStorage.setItem("bestBrain", JSON.stringify(brain));
    localStorage.setItem("bestFitness", record);
}

function persistStats() {
    localStorage.setItem("generation", generation);
    localStorage.setItem("bestFitness", record);
}

function cloneBrain(brain) {
    return JSON.parse(JSON.stringify(brain));
}

function save() {
    if (mode != "AI") return;
    const best = bestOfGeneration();
    record = best.fitness;
    saveBrain(best.brain);
    persistStats();
}

function discard() {
    localStorage.removeItem("bestBrain");
    localStorage.removeItem("bestFitness");
    localStorage.removeItem("generation");
    record = 0;
    generation = 1;
    if (mode == "AI") startGeneration();
}



function generateCars(N) {
    const cars = [];
    for (let i = 0; i < N; i++) {
        cars.push(new Car(road.getLaneCenter(1), START_Y, 30, 50, "AI"));
    }
    return cars;
}

function resetCar(car) {
    car.x = road.getLaneCenter(1);
    car.y = START_Y;
    car.speed = 0;
    car.angle = 0;
    car.damaged = false;
    car.fitness = 0;
    car.windowStart = 0;
}

function startMode() {
    networkCanvas.style.display = mode == "AI" ? "" : "none";
    if (mode == "AI") {
        startGeneration();
    } else {
        if (!player) {
            player = new Car(road.getLaneCenter(1), START_Y, 30, 50, "KEYS");
        }
        restartHuman();
    }
    refreshButtons();
}

function setMode(newMode) {
    mode = newMode;
    localStorage.setItem("mode", mode);
    startMode();
}

function toggleMode() {
    setMode(mode == "AI" ? "HUMAN" : "AI");
}

document.addEventListener("keydown", e => {
    const k = e.key.toLowerCase();
    if (k == "m") {
        toggleMode();
    } else if (mode == "HUMAN" && player.damaged && (k == "r" || k == "enter")) {
        restartHuman();
    }
});

function buildControls() {
    const bar = document.createElement("div");
    bar.style.cssText = "position:fixed;top:10px;left:10px;display:flex;gap:6px;z-index:10;";

    modeBtn = makeButton(toggleMode);
    speedBtn = makeButton(() => {
        speedIndex = (speedIndex + 1) % SPEED_STEPS.length;
        refreshButtons();
    });

    bar.appendChild(modeBtn);
    bar.appendChild(speedBtn);
    document.body.appendChild(bar);
}

function makeButton(onClick) {
    const b = document.createElement("button");
    b.style.cssText = "font:14px sans-serif;padding:6px 10px;cursor:pointer;";
    b.addEventListener("click", () => {
        onClick();
        b.blur(); // so Enter/Space don't re-trigger the button
    });
    return b;
}

function refreshButtons() {
    modeBtn.textContent = mode == "AI" ? "Mode: AI (press M)" : "Mode: HUMAN (press M)";
    speedBtn.textContent = "Speed x" + SPEED_STEPS[speedIndex];
    speedBtn.style.display = mode == "AI" ? "" : "none";
}


function draw(time) {
    carCanvas.height = window.innerHeight;       // (re)setting the size also clears the canvas
    networkCanvas.height = window.innerHeight;

    carCtx.save();
    carCtx.translate(0, -focusCar.y + carCanvas.height * 0.7);

    road.draw(carCtx);
    spawner.draw(carCtx);

    if (mode == "AI") {
        carCtx.globalAlpha = 0.2;
        for (let i = 0; i < aiCars.length; i++) {
            aiCars[i].draw(carCtx, "blue");
        }
        carCtx.globalAlpha = 1;
        focusCar.draw(carCtx, "blue", true);
    } else {
        player.draw(carCtx, "blue", SHOW_SENSORS_IN_HUMAN_MODE);
    }
    carCtx.restore();

    if (mode == "AI") {
        networkCtx.lineDashOffset = -time / 50;
        Visualizer.drawNetwork(networkCtx, focusCar.brain);
    }
    drawHud();
}

function drawHud() {
    let lines;
    if (mode == "AI") {
        const alive = aiCars.filter(c => !c.damaged).length;
        lines = [
            `Gen    ${generation}`,
            `Alive  ${alive}/${N}`,
            `Dist   ${Math.floor(distanceOf(focusCar))}`,
            `Record ${Math.floor(record)}`
        ];
    } else {
        lines = [
            `Score ${Math.floor(distanceOf(player))}`,
            `Best  ${humanBest}`
        ];
    }

    carCtx.font = "12px monospace";
    carCtx.fillStyle = "rgba(0,0,0,0.6)";
    carCtx.fillRect(4, 4, 120, lines.length * 16 + 8);
    carCtx.fillStyle = "white";
    lines.forEach((t, i) => carCtx.fillText(t, 10, 20 + i * 16));

    if (mode == "HUMAN" && player.damaged) {
        carCtx.textAlign = "center";
        carCtx.font = "bold 24px sans-serif";
        carCtx.fillText("CRASHED", carCanvas.width / 2, carCanvas.height * 0.4);
        carCtx.font = "14px sans-serif";
        carCtx.fillText("Press R or Enter", carCanvas.width / 2, carCanvas.height * 0.4 + 26);
        carCtx.textAlign = "left";
    }
}