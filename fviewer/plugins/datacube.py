
class DataCubeMixin:
    def set_slice(self, slice_indices: list[int]):
        """
        Set the current frame/slice for multidimensional FITS data cubes.

        Args:
            slice_indices: A list of 1-based indices for the extra dimensions.
                           For a 3D cube (X, Y, Z), pass [Z].
                           For a 4D cube (X, Y, Z, W), pass [Z, W].

        Example:
            viewer.set_slice([42])     # Move to Z=42
            viewer.set_slice([42, 5])  # Move to Z=42, W=5
        """
        if not isinstance(slice_indices, list):
            # Allow users to pass a single integer for 3D cubes convenience
            slice_indices = [slice_indices]

        return self._send("set_slice", sliceIndices=slice_indices)
