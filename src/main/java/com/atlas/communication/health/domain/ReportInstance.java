package com.atlas.communication.health.domain;

import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.Size;

/**
 * The pod (or process) a health report comes from, when a service runs more than one. Reports
 * that carry an instance are rolled up per service before the monitor evaluates them; see
 * {@link HealthRollup}. {@code leaving} marks an instance's last report (clean shutdown), so it
 * drops out of the rollup at once instead of looking dead until its staleness window passes.
 */
public record ReportInstance(
        @NotBlank @Size(max = 253) String id,
        @Size(max = 253) String namespace,
        @Size(max = 253) String node,
        @Size(max = 100) String cluster,
        @Size(max = 100) String version,
        @Size(max = 100) String sidecar,
        boolean leaving) {
}
