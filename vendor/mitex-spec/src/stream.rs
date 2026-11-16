use super::{ArchivedCommandSpecRepr, CommandSpecRepr};
// DeepBuild patch (windoliver/deepbuild#2359): validated rkyv 0.8 access and pooled deserialization.
use rkyv::{rancor::Error, util::AlignedVec};

enum RkyvStreamData<'a> {
    Aligned(&'a [u8]),
    Unaligned(AlignedVec<16>), // DeepBuild patch (windoliver/deepbuild#2359): explicit alignment.
}

impl AsRef<[u8]> for RkyvStreamData<'_> {
    #[inline]
    fn as_ref(&self) -> &[u8] {
        match self {
            Self::Aligned(v) => v,
            Self::Unaligned(v) => v.as_slice(),
        }
    }
}

pub struct BytesModuleStream<'a> {
    data: RkyvStreamData<'a>,
}

impl<'a> BytesModuleStream<'a> {
    pub fn from_slice(v: &'a [u8]) -> Self {
        // DeepBuild patch (windoliver/deepbuild#2359): rkyv 0.8's AlignedVec is const-generic.
        let v = if !(v.as_ptr() as usize).is_multiple_of(AlignedVec::<16>::ALIGNMENT) {
            let mut aligned = AlignedVec::with_capacity(v.len());
            aligned.extend_from_slice(v);
            RkyvStreamData::Unaligned(aligned)
        } else {
            RkyvStreamData::Aligned(v)
        };

        Self { data: v }
    }

    #[cfg(feature = "rkyv-validation")]
    pub fn checkout(&self) -> &ArchivedCommandSpecRepr {
        // DeepBuild patch (windoliver/deepbuild#2359): keep validation, never unchecked fallback.
        rkyv::access::<ArchivedCommandSpecRepr, Error>(self.data.as_ref()).unwrap()
    }

    /// # Safety
    /// The data source must be trusted and valid.
    pub unsafe fn checkout_unchecked(&self) -> &ArchivedCommandSpecRepr {
        // DeepBuild patch (windoliver/deepbuild#2359): same unsafe contract, new archive API.
        rkyv::access_unchecked::<ArchivedCommandSpecRepr>(self.data.as_ref())
    }

    #[cfg(feature = "rkyv-validation")]
    pub fn checkout_owned(&self) -> CommandSpecRepr {
        // DeepBuild patch (windoliver/deepbuild#2359): rkyv 0.8's high API supplies shared-pointer pooling.
        rkyv::deserialize::<CommandSpecRepr, Error>(self.checkout()).unwrap()
    }

    /// # Safety
    /// The data source must be trusted and valid.
    pub unsafe fn checkout_owned_unchecked(&self) -> CommandSpecRepr {
        // DeepBuild patch (windoliver/deepbuild#2359): preserve the caller's explicit unsafe contract.
        rkyv::deserialize::<CommandSpecRepr, Error>(self.checkout_unchecked()).unwrap()
    }
}
