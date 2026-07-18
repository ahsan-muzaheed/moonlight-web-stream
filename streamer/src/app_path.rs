// streamer/src/app_path.rs
//
// Path-based app launching (additive; app-id launching still works).
//
// When the browser URL supplies owner/appName/version AND the streamer config
// has `app_directory`, we build:
//
//     {app_directory}/{owner}/{appName}/{version}/{appName}.exe
//
// e.g.  z:\0.apps  +  Piranese / ICI_PARIS_XL / 35
//   ->  z:\0.apps\Piranese\ICI_PARIS_XL\35\ICI_PARIS_XL.exe
//
// If any required param is missing, this returns Ok(None) and the caller falls
// back to app-id launching. If the params are present but the exe doesn't exist
// (or a param is unsafe), it returns Err(..) and the caller aborts + reports to
// the browser.
//
// SECURITY: owner/appName/version come from an untrusted URL. Each segment is
// sanitized to prevent path traversal (`..`, separators, drive-letter escapes).
// After building, we canonicalize and verify the result stays inside
// app_directory before accepting it.

use std::{
    collections::HashMap,
    path::{Path, PathBuf},
};

#[derive(Debug)]
pub enum AppPathError {
    UnsafeSegment { field: &'static str, value: String },
    OutsideBaseDir { path: String },
    NotFound { path: String },
}

impl std::fmt::Display for AppPathError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            AppPathError::UnsafeSegment { field, value } => {
                write!(f, "unsafe {field} value: {value:?}")
            }
            AppPathError::OutsideBaseDir { path } => {
                write!(f, "resolved path escapes app_directory: {path}")
            }
            AppPathError::NotFound { path } => {
                write!(f, "app executable not found: {path}")
            }
        }
    }
}

/// Try to build a path-based launch target.
///
/// Returns:
///   Ok(Some(path)) -> use this exe path (params present, safe, exists)
///   Ok(None)       -> params/config absent -> caller uses app-id launching
///   Err(e)         -> params present but invalid/missing -> caller aborts
pub fn resolve_app_exe(
    app_directory: Option<&str>,
    url_params: &HashMap<String, String>,
) -> Result<Option<PathBuf>, AppPathError> {
    // All three params must be present to attempt path mode. Case-sensitive keys
    // matching what the browser sends: owner, appName, version.
    let owner = url_params.get("owner");
    //let app_name = url_params.get("appName");
	 let app_name = url_params.get("app");
    let version = url_params.get("version");

    let (owner, app_name, version) = match (owner, app_name, version) {
        (Some(o), Some(a), Some(v)) if !o.is_empty() && !a.is_empty() && !v.is_empty() => {
            (o, a, v)
        }
        // Not all present -> not a path-based launch. Fall back to app-id.
        _ => return Ok(None),
    };

    // If params are present but no base dir is configured, that's a
    // misconfiguration the operator should see -> treat as an error, not a
    // silent fallback (otherwise a path launch would silently run the wrong app).
    let base = match app_directory {
        Some(b) if !b.is_empty() => b,
        _ => {
            return Err(AppPathError::UnsafeSegment {
                field: "app_directory",
                value: "<unset> but owner/appName/version were supplied".to_string(),
            })
        }
    };

    let owner = sanitize_segment("owner", owner)?;
    let app_name = sanitize_segment("app", app_name)?;
    let version = sanitize_segment("version", version)?;

    // exe name assumed == appName + ".exe"
    let exe_name = format!("{app_name}.exe");

    let base_path = PathBuf::from(base);
    let full = base_path
        .join(&owner)
        .join(&app_name)
        .join(&version)
        .join(&exe_name);

    // Defense in depth: make sure the joined path is still under base. We compare
    // on the *lexical* path (canonicalize needs the file to exist, and we want a
    // clear NotFound error rather than a canonicalize failure). Sanitization
    // already blocks `..` and separators, so a lexical prefix check is sound.
    if !starts_within(&base_path, &full) {
        return Err(AppPathError::OutsideBaseDir {
            path: full.display().to_string(),
        });
    }

    if !full.is_file() {
        return Err(AppPathError::NotFound {
            path: full.display().to_string(),
        });
    }

    Ok(Some(full))
}

/// Allow only a safe charset for a single path segment. Rejects anything that
/// could traverse or escape: separators, `..`, `.`, colons, wildcards, control
/// chars. Permitted: ASCII alphanumerics, `_`, `-`, space. Length-capped.
fn sanitize_segment(field: &'static str, value: &str) -> Result<String, AppPathError> {
    let unsafe_seg = || AppPathError::UnsafeSegment {
        field,
        value: value.to_string(),
    };

    if value.is_empty() || value.len() > 128 {
        return Err(unsafe_seg());
    }
    if value == "." || value == ".." {
        return Err(unsafe_seg());
    }
    for ch in value.chars() {
        let ok = ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' || ch == ' ';
        if !ok {
            return Err(unsafe_seg());
        }
    }
    // No leading/trailing spaces or dots (Windows strips/renames these).
    let trimmed = value.trim();
    if trimmed != value || trimmed.ends_with('.') {
        return Err(unsafe_seg());
    }
    Ok(value.to_string())
}

/// Lexical prefix check: is `candidate` under `base`? Both are normalized to
/// components; `candidate` must start with all of `base`'s components.
fn starts_within(base: &Path, candidate: &Path) -> bool {
    let base_comps: Vec<_> = base.components().collect();
    let cand_comps: Vec<_> = candidate.components().collect();
    if cand_comps.len() < base_comps.len() {
        return false;
    }
    base_comps
        .iter()
        .zip(cand_comps.iter())
        .all(|(a, b)| a == b)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn params(o: &str, a: &str, v: &str) -> HashMap<String, String> {
        let mut m = HashMap::new();
        if !o.is_empty() {
            m.insert("owner".into(), o.into());
        }
        if !a.is_empty() {
            //m.insert("appName".into(), a.into());
			m.insert("app".into(), a.into());     // was "appName"
        }
        if !v.is_empty() {
            m.insert("version".into(), v.into());
        }
        m
    }

    #[test]
    fn missing_params_fall_back() {
        // No params at all -> None (app-id launch)
        assert!(matches!(
            resolve_app_exe(Some("z:\\0.apps"), &HashMap::new()),
            Ok(None)
        ));
        // Partial params -> None
        assert!(matches!(
            resolve_app_exe(Some("z:\\0.apps"), &params("Piranese", "", "35")),
            Ok(None)
        ));
    }

    #[test]
    fn traversal_is_rejected() {
        let p = params("..\\..\\Windows", "System32\\cmd", "1");
        assert!(matches!(
            resolve_app_exe(Some("z:\\0.apps"), &p),
            Err(AppPathError::UnsafeSegment { .. })
        ));
    }

    #[test]
    fn separators_rejected() {
        for bad in ["a/b", "a\\b", "a:b", "a..b", "..", "."] {
            let p = params(bad, "App", "1");
            assert!(
                matches!(
                    resolve_app_exe(Some("z:\\0.apps"), &p),
                    Err(AppPathError::UnsafeSegment { .. })
                ),
                "should reject {bad:?}"
            );
        }
    }

    #[test]
    fn params_without_base_is_error() {
        let p = params("Piranese", "ICI_PARIS_XL", "35");
        assert!(matches!(
            resolve_app_exe(None, &p),
            Err(AppPathError::UnsafeSegment { field: "app_directory", .. })
        ));
    }

    #[test]
    fn valid_builds_path_then_notfound_in_test_env() {
        // The exe won't exist in the test sandbox, so we expect NotFound - but
        // that proves construction + sanitization passed.
        let p = params("Piranese", "ICI_PARIS_XL", "35");
        match resolve_app_exe(Some("/tmp/nonexistent-appdir"), &p) {
            Err(AppPathError::NotFound { path }) => {
                assert!(path.contains("Piranese"));
                assert!(path.contains("ICI_PARIS_XL"));
                assert!(path.ends_with("ICI_PARIS_XL.exe"));
                assert!(path.contains("35"));
            }
            other => panic!("expected NotFound, got {other:?}"),
        }
    }
}
