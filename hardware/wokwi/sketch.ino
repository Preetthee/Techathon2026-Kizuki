const int FAN_1_PIN = 18;
const int FAN_2_PIN = 19;
const int LIGHT_1_PIN = 21;
const int LIGHT_2_PIN = 22;
const int LIGHT_3_PIN = 23;
const int CURRENT_SENSOR_PIN = 34;

struct DeviceReading {
  const char* name;
  const char* type;
  int pin;
  int wattsWhenOn;
};

DeviceReading devices[] = {
  { "Fan 1", "fan", FAN_1_PIN, 60 },
  { "Fan 2", "fan", FAN_2_PIN, 60 },
  { "Light 1", "light", LIGHT_1_PIN, 15 },
  { "Light 2", "light", LIGHT_2_PIN, 15 },
  { "Light 3", "light", LIGHT_3_PIN, 15 }
};

void setup() {
  Serial.begin(115200);
  for (DeviceReading device : devices) {
    pinMode(device.pin, INPUT);
  }
}

void loop() {
  int totalWatts = 0;
  Serial.println("{\"room\":\"Work Room 1\",\"devices\":[");

  for (int i = 0; i < 5; i++) {
    bool on = digitalRead(devices[i].pin) == HIGH;
    int watts = on ? devices[i].wattsWhenOn : 0;
    totalWatts += watts;

    Serial.print("  {\"name\":\"");
    Serial.print(devices[i].name);
    Serial.print("\",\"type\":\"");
    Serial.print(devices[i].type);
    Serial.print("\",\"status\":");
    Serial.print(on ? "true" : "false");
    Serial.print(",\"powerDraw\":");
    Serial.print(watts);
    Serial.print("}");
    Serial.println(i == 4 ? "" : ",");
  }

  int currentRaw = analogRead(CURRENT_SENSOR_PIN);
  Serial.print("],\"totalWatts\":");
  Serial.print(totalWatts);
  Serial.print(",\"currentSensorRaw\":");
  Serial.print(currentRaw);
  Serial.println("}");

  delay(2000);
}
