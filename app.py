from flask import Flask, render_template, request, jsonify
from models import db, Run
import json
import math
import os

app = Flask(__name__)

# ==============================
# CONFIG
# ==============================

app.config['SQLALCHEMY_DATABASE_URI'] = 'sqlite:///racebox.db'
app.config['SQLALCHEMY_TRACK_MODIFICATIONS'] = False

db.init_app(app)


# ==============================
# UTIL FUNCTIONS
# ==============================

def haversine(lat1, lon1, lat2, lon2):
    R = 6371000  # meter
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)

    a = math.sin(dphi/2)**2 + math.cos(phi1)*math.cos(phi2)*math.sin(dlambda/2)**2
    return 2 * R * math.atan2(math.sqrt(a), math.sqrt(1-a))


def calculate_total_distance(route):
    total = 0
    for i in range(1, len(route)):
        lat1, lon1 = route[i - 1]
        lat2, lon2 = route[i]
        total += haversine(lat1, lon1, lat2, lon2)
    return total


def calculate_max_speed(telemetry):
    if not telemetry:
        return 0
    return max(telemetry)


def detect_laps(route, min_distance=300, threshold=10):
    laps = []
    if not route:
        return laps

    start_point = route[0]
    lap_distance = 0

    for i in range(1, len(route)):
        lat1, lon1 = route[i - 1]
        lat2, lon2 = route[i]

        d = haversine(lat1, lon1, lat2, lon2)
        lap_distance += d

        distance_to_start = haversine(lat2, lon2, start_point[0], start_point[1])

        if distance_to_start < threshold and lap_distance > min_distance:
            laps.append(round(lap_distance, 2))
            lap_distance = 0

    return laps


# ==============================
# AI PERFORMANCE ANALYSIS
# ==============================

def analyze_run(max_speed, zero_to_hundred, distance):
    if zero_to_hundred and zero_to_hundred > 12:
        return "Start lambat. Throttle kurang agresif."

    if max_speed < 90:
        return "Top speed rendah. Periksa kondisi mesin."

    if distance < 100:
        return "Run terlalu pendek untuk analisis optimal."

    if max_speed > 180:
        return "Kecepatan tinggi. Pastikan keamanan berkendara."

    return "Performa sangat baik. Akselerasi stabil."


# ==============================
# ROUTES
# ==============================

def read_settings():
    defaults = {"speed_unit": "kmh", "distance_unit": "m", "accel_target": "100", "gps_accuracy": 20}
    speed_unit = request.cookies.get("rb_speed_unit")
    distance_unit = request.cookies.get("rb_distance_unit")
    accel_target = request.cookies.get("rb_accel_target")
    gps_accuracy = request.cookies.get("rb_gps_accuracy")
    if speed_unit in {"kmh", "mph"}:
        defaults["speed_unit"] = speed_unit
    if distance_unit in {"m", "ft"}:
        defaults["distance_unit"] = distance_unit
    if accel_target in {"60", "100"}:
        defaults["accel_target"] = accel_target
    if gps_accuracy in {"10", "20", "35"}:
        defaults["gps_accuracy"] = int(gps_accuracy)
    return defaults


@app.route("/")
def index():
    return render_template("index.html", settings=read_settings())


@app.route("/history")
def history():
    runs = Run.query.order_by(Run.created_at.desc()).all()
    return render_template("history.html", runs=runs)


@app.route("/settings", methods=["GET", "POST"])
def settings():
    if request.method == "POST":
        allowed_values = {
            "speed_unit": {"kmh", "mph"},
            "distance_unit": {"m", "ft"},
            "accel_target": {"60", "100"},
            "gps_accuracy": {"10", "20", "35"},
        }
        settings = {
            key: request.form.get(key) if request.form.get(key) in allowed else default
            for key, allowed, default in (
                ("speed_unit", allowed_values["speed_unit"], "kmh"),
                ("distance_unit", allowed_values["distance_unit"], "m"),
                ("accel_target", allowed_values["accel_target"], "100"),
                ("gps_accuracy", allowed_values["gps_accuracy"], "20"),
            )
        }
        response = app.make_response(render_template("settings.html", settings={**settings, "gps_accuracy": int(settings["gps_accuracy"])}))
        for key, value in settings.items():
            response.set_cookie(f"rb_{key}", value, max_age=31536000, httponly=True, samesite="Lax")
        return response
    return render_template("settings.html", settings=read_settings())


# ==============================
# API SAVE RUN (VALIDATED VERSION)
# ==============================

@app.route("/api/save_run", methods=["POST"])
def save_run():

    if not request.is_json:
        return jsonify({"error": "Invalid request format"}), 400

    data = request.json

    route_data = data.get("route_data", [])
    telemetry_data = data.get("telemetry_data", [])
    zero_to_hundred = data.get("zero_to_hundred")

    # ==========================
    # VALIDATION
    # ==========================

    if len(route_data) < 2:
        return jsonify({"error": "Route data tidak valid"}), 400

    total_distance = calculate_total_distance(route_data)
    max_speed = calculate_max_speed(telemetry_data)

    # Anti cheat rules
    if max_speed > 300:
        return jsonify({"error": "Speed tidak masuk akal"}), 400

    if total_distance < 10:
        return jsonify({"error": "Distance terlalu kecil"}), 400

    laps = detect_laps(route_data)

    analysis = analyze_run(max_speed, zero_to_hundred, total_distance)

    run = Run(
        max_speed=round(max_speed, 2),
        zero_to_hundred=zero_to_hundred,
        distance=round(total_distance, 2),
        route_data=json.dumps(route_data),
        telemetry_data=json.dumps(telemetry_data),
        lap_data=json.dumps(laps),
        analysis=analysis
    )

    db.session.add(run)
    db.session.commit()

    return jsonify({
        "message": "Run validated & saved",
        "analysis": analysis,
        "laps": laps
    })


# ==============================
# API GET ALL RUNS
# ==============================

@app.route("/api/history")
def api_history():
    runs = Run.query.order_by(Run.created_at.desc()).all()
    return jsonify([run.to_dict() for run in runs])


# ==============================
# API GET SINGLE RUN
# ==============================

@app.route("/api/run/<int:run_id>")
def get_run(run_id):
    run = Run.query.get_or_404(run_id)
    return jsonify(run.to_dict())


# ==============================
# INIT DATABASE
# ==============================

if __name__ == "__main__":
    with app.app_context():
        db.create_all()
    app.run(host="0.0.0.0", port=int(os.environ.get("PORT", 5000)), debug=True)
