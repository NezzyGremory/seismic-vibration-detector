"""Model Pydantic untuk validasi data sensor."""

from typing import Literal

from pydantic import BaseModel, Field, field_validator

from . import config


class SensorReading(BaseModel):
    """Satu sampel accelerometer dari satu device."""

    device_id: str = Field(
        ...,
        min_length=1,
        max_length=64,
        strict=True
    )

    # Epoch time. Server menyimpannya apa adanya
    # (detik atau milidetik).
    timestamp: float = Field(
        ...,
        strict=True,
        allow_inf_nan=False
    )

    x: float = Field(
        ...,
        strict=True,
        allow_inf_nan=False
    )

    y: float = Field(
        ...,
        strict=True,
        allow_inf_nan=False
    )

    z: float = Field(
        ...,
        strict=True,
        allow_inf_nan=False
    )

    @field_validator("device_id")
    @classmethod
    def device_id_not_blank(cls, v: str) -> str:
        v = v.strip()

        if not v:
            raise ValueError("device_id tidak boleh kosong")

        return v

    @field_validator("x", "y", "z")
    @classmethod
    def axis_in_range(cls, v: float) -> float:
        if abs(v) > config.MAX_ABS_ACCELERATION:
            raise ValueError(
                f"nilai di luar batas +/-{config.MAX_ABS_ACCELERATION}"
            )

        return v


class SensorResponse(BaseModel):
    """Hasil analisis untuk satu sampel."""

    success: bool = True
    device_id: str

    # acceleration magnitude
    # BUKAN magnitudo gempa.
    magnitude: float

    rms: float
    peak: float

    status: Literal[
        "NORMAL",
        "ANOMALY_VIBRATION"
    ]

    window_samples: int
    window_ready: bool


class FloodSensorData(BaseModel):
    """Data virtual sensor untuk monitoring banjir."""

    device_id: str = Field(
        ...,
        min_length=1,
        max_length=64,
        strict=True
    )

    sensor_type: Literal["flood"] = "flood"

    # Ketinggian air dalam centimeter.
    water_level: float = Field(
        ...,
        strict=True,
        allow_inf_nan=False,
        ge=0
    )

    # Kecepatan kenaikan ketinggian air
    # dalam centimeter per jam.
    rate_of_rise: float = Field(
        ...,
        strict=True,
        allow_inf_nan=False
    )

    # Curah hujan dalam millimeter per jam.
    rainfall: float = Field(
        ...,
        strict=True,
        allow_inf_nan=False,
        ge=0
    )

    @field_validator("device_id")
    @classmethod
    def flood_device_id_not_blank(cls, v: str) -> str:
        v = v.strip()

        if not v:
            raise ValueError("device_id tidak boleh kosong")

        return v