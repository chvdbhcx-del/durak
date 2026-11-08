//! Durak rules and bots for WebAssembly. The page sends a game as JSON and gets the bot's move back
//! as JSON; everything runs in a Web Worker so the table never stutters while a bot thinks.

pub mod bot;
pub mod game;

use bot::{choose_action, Budget};
use game::{GameState, Level};

/// Works out a bot's move. `level`: 0 easy, 1 normal, 2 hard, anything else the game's own level.
pub fn choose_json(state: &str, actor: usize, level: i32, budget: Budget) -> Result<String, String> {
    let s: GameState = serde_json::from_str(state).map_err(|e| e.to_string())?;
    if actor >= s.players.len() {
        return Err("no such seat".into());
    }
    let level = match level {
        0 => Some(Level::Easy),
        1 => Some(Level::Normal),
        2 => Some(Level::Hard),
        _ => None,
    };
    let action = choose_action(&s, actor, level, false, &budget)?;
    serde_json::to_string(&action).map_err(|e| e.to_string())
}

#[cfg(target_arch = "wasm32")]
mod wasm {
    use super::*;
    use std::cell::RefCell;

    #[link(wasm_import_module = "env")]
    extern "C" {
        /// `performance.now()` from the page, for the hard bot's thinking budget.
        fn now() -> f64;
    }

    thread_local! {
        static OUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
    }

    fn clock() -> f64 {
        unsafe { now() }
    }

    #[no_mangle]
    pub extern "C" fn alloc(len: usize) -> *mut u8 {
        let mut buf = Vec::<u8>::with_capacity(len);
        let ptr = buf.as_mut_ptr();
        std::mem::forget(buf);
        ptr
    }

    #[no_mangle]
    pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
        drop(Vec::from_raw_parts(ptr, 0, len));
    }

    /// Returns the length of the answer (read it at `out_ptr`): a move as JSON, or `!` and an error.
    #[no_mangle]
    pub unsafe extern "C" fn choose(ptr: *const u8, len: usize, actor: usize, level: i32, budget_ms: f64) -> usize {
        let input = std::str::from_utf8(std::slice::from_raw_parts(ptr, len)).unwrap_or("");
        let answer = match choose_json(input, actor, level, Budget { now: clock, ms: budget_ms }) {
            Ok(json) => json,
            Err(e) => format!("!{}", e),
        };
        OUT.with(|o| {
            let mut o = o.borrow_mut();
            *o = answer.into_bytes();
            o.len()
        })
    }

    #[no_mangle]
    pub extern "C" fn out_ptr() -> *const u8 {
        OUT.with(|o| o.borrow().as_ptr())
    }
}
