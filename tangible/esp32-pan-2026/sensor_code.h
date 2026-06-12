#pragma once

// BNO055 compass heading in degrees (0.00–359.99).
// Requires Adafruit_BNO055 + Adafruit Unified Sensor (Arduino Library Manager).

bool sensorCodeBegin();
void sensorCodeUpdate();
float sensorCodeGetHeading();
