// Endless traffic: keeps spawning rows of cars ahead of the player(s) and
// removes them once they're far behind.
//
// Every row leaves at least one lane free, and the free lane can only shift by
// one lane between consecutive rows, so there is ALWAYS a path through.
// All traffic drives at the same speed so the rows keep their spacing
// (mixed speeds would let cars in different lanes drift into a solid wall).
class TrafficSpawner {
    constructor(road, options = {}) {
        this.road = road;
        this.speed = options.speed ?? 2;                       // traffic max speed
        this.spawnAhead = options.spawnAhead ?? 900;           // keep rows spawned this far ahead
        this.despawnBehind = options.despawnBehind ?? 700;     // delete cars this far behind
        this.gapEasy = options.gapEasy ?? [280, 420];          // distance between rows at the start
        this.gapHard = options.gapHard ?? [170, 260];          // ...and at max difficulty
        this.breatherChance = options.breatherChance ?? 0.15;  // chance of a much bigger gap
        this.colors = ["#e74c3c", "#e67e22", "#f1c40f", "#9b59b6", "#1abc9c", "#ecf0f1"];

        this.cars = [];
        this.safeLane = Math.floor(road.laneCount / 2);
    }

    reset(startY) {
        this.cars = [];
        this.safeLane = Math.floor(this.road.laneCount / 2);
        this.#spawnRow(startY - 350);
    }

    // frontY / rearY: y of the foremost and rearmost living player car.
    // difficulty: 0..1, shrinks the gaps between rows.
    update(frontY, rearY, difficulty = 0) {
        this.cars.forEach(c => c.update(this.road.borders, []));
        this.cars = this.cars.filter(c => c.y < rearY + this.despawnBehind);

        let top = this.cars.length ? Math.min(...this.cars.map(c => c.y)) : frontY - 400;
        while (top > frontY - this.spawnAhead) {
            top -= this.#nextGap(difficulty);
            this.#spawnRow(top);
        }
    }

    draw(ctx) {
        this.cars.forEach(c => c.draw(ctx, false)); // traffic never shows sensors, it has none
    }

    #nextGap(difficulty) {
        const min = lerp(this.gapEasy[0], this.gapHard[0], difficulty);
        const max = lerp(this.gapEasy[1], this.gapHard[1], difficulty);
        let gap = min + Math.random() * (max - min);
        if (Math.random() < this.breatherChance) {
            gap *= 1.8;
        }
        return gap;
    }

    #spawnRow(y) {
        const laneCount = this.road.laneCount;

        // the guaranteed-free lane drifts by at most one lane per row
        const shift = Math.floor(Math.random() * 3) - 1;
        this.safeLane = Math.max(0, Math.min(laneCount - 1, this.safeLane + shift));

        const lanes = [];
        for (let l = 0; l < laneCount; l++) {
            if (l != this.safeLane) lanes.push(l);
        }
        lanes.sort(() => Math.random() - 0.5);

        const count = 1 + Math.floor(Math.random() * lanes.length); // 1 .. laneCount-1 cars
        for (let i = 0; i < count; i++) {
            this.cars.push(this.#makeCar(lanes[i], y));
        }
    }

    #makeCar(lane, y) {
        const color = this.colors[Math.floor(Math.random() * this.colors.length)];
        const car = new Car(this.road.getLaneCenter(lane), y, 30, 50, "DUMMY", this.speed, color);
        car.update(this.road.borders, []); // builds car.polygon so it can be drawn/sensed immediately
        return car;
    }
}