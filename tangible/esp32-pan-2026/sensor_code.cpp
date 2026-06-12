#include "sensor_code.h"

#include <Arduino.h>
#include <Wire.h>
#include <Adafruit_BNO055.h>

#ifndef BNO_SDA_PIN
#define BNO_SDA_PIN 8
#endif

#ifndef BNO_SCL_PIN
#define BNO_SCL_PIN 9
#endif

static Adafruit_BNO055 bno(55, 0x28, &Wire);
static bool gSensorReady = false;
static bool gHasHeading = false;
static float gSmoothedHeading = 0.0f;

static float normalizeHeading(float heading) {
  while (heading < 0.0f) heading += 360.0f;
  while (heading >= 360.0f) heading -= 360.0f;
  return heading;
}

static float lerpAngle(float current, float target, float t) {
  float delta = target - current;
  while (delta > 180.0f) delta -= 360.0f;
  while (delta < -180.0f) delta += 360.0f;
  return normalizeHeading(current + delta * t);
}

static float readHeadingDeg() {
  sensors_event_t event;
  bno.getEvent(&event);
  return normalizeHeading(event.orientation.x);
}

bool sensorCodeBegin() {
  Wire.begin(BNO_SDA_PIN, BNO_SCL_PIN);
  Wire.setClock(100000);

  Serial.println("[Sensor] starting BNO055...");

  if (!bno.begin(OPERATION_MODE_COMPASS)) {
    Serial.println("[Sensor] BNO055 not detected. Check wiring.");
    return false;
  }

  delay(1000);

  gSmoothedHeading = readHeadingDeg();
  gHasHeading = true;
  gSensorReady = true;

  Serial.print("[Sensor] BNO055 ready. Heading: ");
  Serial.println(gSmoothedHeading, 2);
  return true;
}

void sensorCodeUpdate() {
  if (!gSensorReady) return;

  const float target = readHeadingDeg();
  if (!gHasHeading) {
    gSmoothedHeading = target;
    gHasHeading = true;
    return;
  }

  gSmoothedHeading = lerpAngle(gSmoothedHeading, target, 0.18f);
}

float sensorCodeGetHeading() {
  if (!gSensorReady || !gHasHeading) return 0.0f;
  return gSmoothedHeading;
}
