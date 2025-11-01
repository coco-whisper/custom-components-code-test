// $mvt global runtime implementation
// This is a global object that should be available to all compiled components

window.$mvt = {
  currentUser: () => ({
    id: "test-user",
    name: "Test User",
  }),
  store: {
    // Your implementation here (localStorage is fine)
    getItem: async (key) => {
      // Implement localStorage get
      try {
        const value = localStorage.getItem(key);
        return value ? JSON.parse(value) : null;
      } catch (error) {
        console.error('Error getting item from store:', error);
        return null;
      }
    },
    setItem: async (key, value) => {
      // Implement localStorage set
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (error) {
        console.error('Error setting item in store:', error);
      }
    },
  },
}

export default window.$mvt
