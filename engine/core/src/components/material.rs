use glam::Vec3;

/// Material component — how an entity's Mesh is shaded.
///
/// The target model is metallic-roughness PBR. For now a Material holds only
/// a base colour; roughness, metalness, emission and alpha are added later
/// without changing the wire format (ADR-038).
///
/// A Material without a Mesh has no effect. A Mesh without a Material is
/// drawn with `Material::default()`.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Material {
    /// Base colour as sRGB red, green and blue, each in 0 to 1: the way a
    /// colour is authored, not a linear value. Range and finiteness are
    /// checked where JSON enters the engine (reflection), not by this type.
    pub base_color: Vec3,
}

impl Material {
    /// Creates a Material with the given base colour.
    pub fn new(base_color: Vec3) -> Self {
        Self { base_color }
    }
}

impl Default for Material {
    /// Creates a white Material.
    fn default() -> Self {
        Self::new(Vec3::ONE)
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn material_default_is_white() {
        // ARRANGE + ACT
        let material = Material::default();

        // ASSERT — written as a literal so it does not depend on new()
        assert_eq!(material.base_color, Vec3::new(1.0, 1.0, 1.0));
    }

    #[test]
    fn material_new_sets_base_color() {
        // ARRANGE — a colour that is neither black nor white, so a
        // constructor that ignores its argument cannot pass
        let color = Vec3::new(0.2, 0.4, 0.6);

        // ACT
        let material = Material::new(color);

        // ASSERT
        assert_eq!(material.base_color, color);
    }
}
