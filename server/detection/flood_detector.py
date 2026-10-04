from dataclasses import dataclass


@dataclass
class FloodResult:
    status: str
    message: str
    risk_level: int


def detect_flood(
    water_level: float,
    rate_of_rise: float,
    rainfall: float
) -> FloodResult:

    # CRITICAL
    if water_level >= 80:
        return FloodResult(
            status="FLOOD_CRITICAL",
            message="Ketinggian air berada pada level kritis",
            risk_level=3
        )

    # ALERT
    if (
        water_level >= 50
        or rate_of_rise >= 5
    ):
        return FloodResult(
            status="FLOOD_ALERT",
            message="Potensi banjir terdeteksi",
            risk_level=2
        )

    # WARNING
    if (
        water_level >= 30
        or rate_of_rise >= 3
    ):
        return FloodResult(
            status="FLOOD_WARNING",
            message="Kenaikan air mulai terdeteksi",
            risk_level=1
        )

    # NORMAL
    return FloodResult(
        status="NORMAL",
        message="Kondisi air masih dalam batas normal",
        risk_level=0
    )