//! Issue #518: an export's ring of GPU surface slots, handed once to an encode tool's process
//! (Export: encode job). On macOS a slot is an IOSurface: the export checks a name of its own
//! into the bootstrap namespace, and the tool, a child that looks the name up, is sent every
//! slot's Mach port in one Mach message, the transport XPC rides on; a process that isn't
//! launchd's can't listen for XPC by name. The tool then reads or writes a slot's rows in place,
//! the same memory the export's GPU draws into. Only the slots cross: the tool reaches neither
//! the GPU device nor anything a window shows.

use std::ffi::{c_void, CString};

type Port = u32;
type Kern = i32;
/// An `IOSurfaceRef`.
pub type Surface = *mut c_void;

/// The most slots a ring holds: `frame_delay` (at most 16) + 2.
pub const MOST: usize = 18;

const SEND: i32 = 0x1;
const RECEIVE: i32 = 0x2;
const SEND_TIMEOUT: i32 = 0x10;
const RECEIVE_TIMEOUT: i32 = 0x100;
const COMPLEX: u32 = 0x8000_0000;
const MOVE_SEND: u8 = 17;
const MOVE_SEND_ONCE: u32 = 18;
const COPY_SEND: u32 = 19;
const MAKE_SEND_ONCE: u32 = 21;
const RIGHT_RECEIVE: u32 = 1;
const ASK: i32 = 517;
const SLOTS: i32 = 518;

#[repr(C, packed(4))]
#[derive(Clone, Copy, Default)]
struct Header {
    bits: u32,
    size: u32,
    remote: Port,
    local: Port,
    voucher: Port,
    id: i32,
}

#[repr(C, packed(4))]
#[derive(Clone, Copy, Default)]
struct Descriptor {
    name: Port,
    pad1: u32,
    pad2: u16,
    disposition: u8,
    kind: u8,
}

/// A message of up to [`MOST`] port descriptors, with room for the trailer a receive appends.
#[repr(C, packed(4))]
#[derive(Clone, Copy)]
struct Message {
    head: Header,
    count: u32,
    ports: [Descriptor; MOST],
    trailer: [u32; 16],
}

impl Message {
    fn empty() -> Message {
        Message {
            head: Header::default(),
            count: 0,
            ports: [Descriptor::default(); MOST],
            trailer: [0; 16],
        }
    }
}

extern "C" {
    static mach_task_self_: Port;
    static bootstrap_port: Port;
    fn bootstrap_check_in(bp: Port, name: *const libc::c_char, port: *mut Port) -> Kern;
    fn bootstrap_look_up(bp: Port, name: *const libc::c_char, port: *mut Port) -> Kern;
    fn mach_port_allocate(task: Port, right: u32, name: *mut Port) -> Kern;
    fn mach_port_mod_refs(task: Port, name: Port, right: u32, delta: i32) -> Kern;
    fn mach_port_deallocate(task: Port, name: Port) -> Kern;
    fn mach_msg(
        msg: *mut Header,
        option: i32,
        send_size: u32,
        receive_size: u32,
        receive_name: Port,
        timeout: u32,
        notify: Port,
    ) -> Kern;
}

#[link(name = "IOSurface", kind = "framework")]
extern "C" {
    fn IOSurfaceCreateMachPort(surface: Surface) -> Port;
    fn IOSurfaceLookupFromMachPort(port: Port) -> Surface;
    fn IOSurfaceLock(surface: Surface, options: u32, seed: *mut u32) -> Kern;
    fn IOSurfaceUnlock(surface: Surface, options: u32, seed: *mut u32) -> Kern;
    fn IOSurfaceGetBaseAddress(surface: Surface) -> *mut u8;
    fn IOSurfaceGetBytesPerRow(surface: Surface) -> usize;
    fn IOSurfaceGetWidth(surface: Surface) -> usize;
    fn IOSurfaceGetHeight(surface: Surface) -> usize;
}

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    fn CFRelease(cf: *const c_void);
}

/// The export's side: the name a tool looks up, checked in before the tool starts.
pub struct Offer {
    port: Port,
    pub name: String,
}

impl Offer {
    /// Checks `name` into the bootstrap namespace: the name is the export's own, by its process
    /// and its export.
    pub fn new(name: &str) -> Result<Offer, String> {
        let c = CString::new(name).map_err(|e| e.to_string())?;
        let mut port: Port = 0;
        // SAFETY: the name is a C string that lives through the call, and `port` is ours.
        let kr = unsafe { bootstrap_check_in(bootstrap_port, c.as_ptr(), &mut port) };
        if kr != 0 {
            return Err(format!("bootstrap_check_in {name}: {kr}"));
        }
        Ok(Offer {
            port,
            name: name.into(),
        })
    }

    /// Waits up to `ms` for the tool's ask and answers it with every slot's port, once.
    ///
    /// # Safety
    /// Each of `slots` is a live `IOSurfaceRef`.
    pub unsafe fn send(&self, slots: &[Surface], ms: u32) -> Result<(), String> {
        if slots.len() > MOST {
            return Err(format!("a ring holds at most {MOST} slots"));
        }
        let mut ask = Message::empty();
        let size = std::mem::size_of::<Message>() as u32;
        let kr = mach_msg(
            &mut ask.head,
            RECEIVE | RECEIVE_TIMEOUT,
            0,
            size,
            self.port,
            ms,
            0,
        );
        if kr != 0 {
            return Err(format!("the tool didn't ask for its slots: {kr}"));
        }
        let mut out = Message::empty();
        out.head.bits = MOVE_SEND_ONCE | COMPLEX;
        out.head.remote = ask.head.remote;
        out.head.id = SLOTS;
        out.count = slots.len() as u32;
        for (d, s) in out.ports.iter_mut().zip(slots) {
            *d = Descriptor {
                name: IOSurfaceCreateMachPort(*s),
                pad1: 0,
                pad2: 0,
                disposition: MOVE_SEND,
                kind: 0,
            };
        }
        out.head.size = (std::mem::size_of::<Header>() + 4 + 12 * slots.len()) as u32;
        let sent = out.head.size;
        let kr = mach_msg(&mut out.head, SEND | SEND_TIMEOUT, sent, 0, 0, ms, 0);
        match kr {
            0 => Ok(()),
            _ => Err(format!("the slots couldn't be sent: {kr}")),
        }
    }
}

impl Drop for Offer {
    fn drop(&mut self) {
        // SAFETY: the receive right is this offer's own.
        unsafe { mach_port_mod_refs(mach_task_self_, self.port, RIGHT_RECEIVE, -1) };
    }
}

/// The tool's side: the slots it was handed, in the ring's order.
pub struct Ring {
    slots: Vec<Surface>,
}

// SAFETY: an IOSurface is read and written under its own lock, from any thread.
unsafe impl Send for Ring {}

impl Ring {
    /// Looks `name` up, asks the export for the ring and takes its slots, waiting up to `ms`.
    pub fn take(name: &str, ms: u32) -> Result<Ring, String> {
        let c = CString::new(name).map_err(|e| e.to_string())?;
        // SAFETY: plain Mach calls on ports this function makes and owns; every received name
        // is a send right the message moved to this task.
        unsafe {
            let (mut service, mut mine): (Port, Port) = (0, 0);
            let kr = bootstrap_look_up(bootstrap_port, c.as_ptr(), &mut service);
            if kr != 0 {
                return Err(format!("bootstrap_look_up {name}: {kr}"));
            }
            let kr = mach_port_allocate(mach_task_self_, RIGHT_RECEIVE, &mut mine);
            if kr != 0 {
                return Err(format!("mach_port_allocate: {kr}"));
            }
            let mut ask = Header {
                bits: COPY_SEND | (MAKE_SEND_ONCE << 8),
                size: std::mem::size_of::<Header>() as u32,
                remote: service,
                local: mine,
                voucher: 0,
                id: ASK,
            };
            let size = ask.size;
            let kr = mach_msg(&mut ask, SEND | SEND_TIMEOUT, size, 0, 0, ms, 0);
            mach_port_deallocate(mach_task_self_, service);
            if kr != 0 {
                return Err(format!("the ask for the slots couldn't be sent: {kr}"));
            }
            let mut got = Message::empty();
            let size = std::mem::size_of::<Message>() as u32;
            let kr = mach_msg(
                &mut got.head,
                RECEIVE | RECEIVE_TIMEOUT,
                0,
                size,
                mine,
                ms,
                0,
            );
            mach_port_mod_refs(mach_task_self_, mine, RIGHT_RECEIVE, -1);
            if kr != 0 || got.head.id != SLOTS {
                return Err(format!("no slots came: {kr}"));
            }
            let ports = got.ports;
            let mut slots = Vec::new();
            for d in ports.iter().take((got.count as usize).min(MOST)) {
                let s = IOSurfaceLookupFromMachPort(d.name);
                mach_port_deallocate(mach_task_self_, d.name);
                if s.is_null() {
                    return Err("a slot's port names no surface".into());
                }
                slots.push(s);
            }
            Ok(Ring { slots })
        }
    }

    pub fn len(&self) -> usize {
        self.slots.len()
    }

    pub fn is_empty(&self) -> bool {
        self.slots.is_empty()
    }

    /// Slot `i`'s BGRA8 rows, top-down without padding.
    pub fn read(&self, i: usize) -> Option<Vec<u8>> {
        // SAFETY: the slot is one this ring was handed and keeps.
        Some(unsafe { read(*self.slots.get(i)?) })
    }

    /// Writes `bgra`, a `w` × `h` block of BGRA8 rows, into slot `i`'s top-left corner.
    pub fn write(&self, i: usize, bgra: &[u8], [w, h]: [usize; 2]) -> bool {
        let Some(s) = self.slots.get(i) else {
            return false;
        };
        // SAFETY: as in `read`.
        unsafe { write(*s, bgra, [w, h]) };
        true
    }
}

impl Drop for Ring {
    fn drop(&mut self) {
        for s in &self.slots {
            // SAFETY: each lookup handed this ring one reference.
            unsafe { CFRelease(*s) };
        }
    }
}

/// A surface's BGRA8 rows, top-down without padding.
///
/// # Safety
/// `s` is a live `IOSurfaceRef` of 4-byte pixels.
pub unsafe fn read(s: Surface) -> Vec<u8> {
    IOSurfaceLock(s, 1, std::ptr::null_mut());
    let (w, h, stride) = (
        IOSurfaceGetWidth(s),
        IOSurfaceGetHeight(s),
        IOSurfaceGetBytesPerRow(s),
    );
    let base = IOSurfaceGetBaseAddress(s);
    let mut out = Vec::with_capacity(w * h * 4);
    for y in 0..h {
        out.extend_from_slice(std::slice::from_raw_parts(base.add(y * stride), w * 4));
    }
    IOSurfaceUnlock(s, 1, std::ptr::null_mut());
    out
}

/// Writes a `w` × `h` block of BGRA8 rows into a surface's top-left corner.
///
/// # Safety
/// `s` is a live `IOSurfaceRef` of 4-byte pixels.
pub unsafe fn write(s: Surface, bgra: &[u8], [w, h]: [usize; 2]) {
    IOSurfaceLock(s, 0, std::ptr::null_mut());
    let stride = IOSurfaceGetBytesPerRow(s);
    let (w, h) = (w.min(IOSurfaceGetWidth(s)), h.min(IOSurfaceGetHeight(s)));
    let base = IOSurfaceGetBaseAddress(s);
    for (y, row) in bgra.chunks_exact(w.max(1) * 4).take(h).enumerate() {
        std::ptr::copy_nonoverlapping(row.as_ptr(), base.add(y * stride), w * 4);
    }
    IOSurfaceUnlock(s, 0, std::ptr::null_mut());
}
