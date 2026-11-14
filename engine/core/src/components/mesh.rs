/// The geometry a [`Mesh`] draws.
///
/// Primitives have no parameters (ADR-039 decision 10). Each has a fixed
/// size in local units, centred on the entity's origin, and the entity's
/// transform scale sizes it, as in Unity:
/// - `Box`: a cube of side 1;
/// - `Sphere`: diameter 1;
/// - `Cylinder`: diameter 1 and height 2, its axis along local Y;
/// - `Plane`: 10 by 10 in the local XZ plane, single-sided, facing +Y.
///
/// The renderer owns the geometry; these sizes are its contract.
///
/// Serialized as an externally tagged enum of empty struct variants, so the
/// wire form is `{"Box":{}}`: the object form a variant with fields (Phase
/// 20d's `Model { key }`) needs, without changing the format again.
///
/// Unknown fields are denied, so a pre-20c `{"Box":{"size":[..]}}` is
/// rejected naming `size` instead of being drawn at the wrong size.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub enum MeshShape {
    /// A cube of side 1.
    Box {},
    /// A sphere of diameter 1.
    Sphere {},
    /// A cylinder of diameter 1 and height 2 along local Y.
    Cylinder {},
    /// A 10 by 10 single-sided plane in local XZ, facing +Y.
    Plane {},
}

/// Mesh component — the geometry an entity is drawn with.
///
/// An entity without a Mesh is not drawn. A Mesh is drawn with the entity's
/// Material, or with the default Material when it has none.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize, serde::Deserialize)]
pub struct Mesh {
    /// The geometry to draw.
    pub shape: MeshShape,
}

impl Mesh {
    /// Creates a Mesh with the given shape.
    pub fn new(shape: MeshShape) -> Self {
        Self { shape }
    }
}

impl Default for Mesh {
    /// Creates a Mesh with a Box.
    fn default() -> Self {
        Self::new(MeshShape::Box {})
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────
#[cfg(test)]
mod tests {
    use super::*;

    const ALL: [(MeshShape, &str); 4] = [
        (MeshShape::Box {}, "Box"),
        (MeshShape::Sphere {}, "Sphere"),
        (MeshShape::Cylinder {}, "Cylinder"),
        (MeshShape::Plane {}, "Plane"),
    ];

    #[test]
    fn mesh_new_sets_shape() {
        let mesh = Mesh::new(MeshShape::Sphere {});

        assert_eq!(mesh.shape, MeshShape::Sphere {});
    }

    #[test]
    fn mesh_default_is_a_box() {
        assert_eq!(Mesh::default().shape, MeshShape::Box {});
    }

    #[test]
    fn mesh_shape_serializes_as_an_externally_tagged_empty_object() {
        for (shape, name) in ALL {
            let json = serde_json::to_value(shape).unwrap();

            assert_eq!(json, serde_json::json!({ name: {} }), "{name}");
        }
    }

    #[test]
    fn mesh_shape_deserializes_from_an_empty_object() {
        for (shape, name) in ALL {
            let parsed: MeshShape =
                serde_json::from_value(serde_json::json!({ name: {} })).unwrap();

            assert_eq!(parsed, shape, "{name}");
        }
    }

    #[test]
    fn mesh_shape_rejects_the_unit_variant_form() {
        let result = serde_json::from_value::<MeshShape>(serde_json::json!("Box"));

        assert!(result.is_err(), "{result:?}");
    }

    #[test]
    fn mesh_shape_rejects_a_pre_20c_parameter_naming_it() {
        // What an older client or scene sends. Dropping the size silently
        // would draw the wrong thing; reject it and say why.
        // (payload, the fields serde may name: it reports whichever unknown
        // field it meets first, and key order depends on serde_json features).
        let stale: [(serde_json::Value, &[&str]); 4] = [
            (
                serde_json::json!({ "Box": { "size": [0.8, 0.8, 0.8] } }),
                &["size"],
            ),
            (
                serde_json::json!({ "Sphere": { "radius": 0.5 } }),
                &["radius"],
            ),
            (
                serde_json::json!({ "Cylinder": { "radius": 0.5, "height": 2.0 } }),
                &["radius", "height"],
            ),
            (
                serde_json::json!({ "Plane": { "size": [10.0, 10.0] } }),
                &["size"],
            ),
        ];
        for (json, fields) in stale {
            let result = serde_json::from_value::<MeshShape>(json.clone());

            match result {
                Err(e) => assert!(
                    fields
                        .iter()
                        .any(|field| e.to_string().contains(&format!("unknown field `{field}`"))),
                    "{json}: {e}"
                ),
                Ok(shape) => panic!("{json} was accepted as {shape:?}"),
            }
        }
    }
}
