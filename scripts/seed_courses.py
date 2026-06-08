import os
import sys
from pathlib import Path

sys.path.append(str(Path(__file__).parent.parent))

from backend.core.database import supabase_admin

PROF_EMAIL = "prof@admin.com"
PROF_PASSWORD = "Academy2026!"

COURSES = [
    # Semester 1
    {"title": "Objektorientierte Programmierung", "description": "9 LP - 1. Semester", "color": "bg-orange-500", "icon": "Code"},
    {"title": "Technische Informatik", "description": "9 LP - 1. Semester", "color": "bg-orange-500", "icon": "Cpu"},
    {"title": "Grundlagen der linearen Algebra", "description": "9 LP - 1. Semester", "color": "bg-orange-500", "icon": "Calculator"},
    
    # Semester 2
    {"title": "Algorithmen und Datenstrukturen", "description": "9 LP - 2. Semester", "color": "bg-orange-400", "icon": "Network"},
    {"title": "Deklarative Programmierung", "description": "9 LP - 2. Semester", "color": "bg-orange-400", "icon": "FunctionSquare"},
    {"title": "Programmierpraktikum", "description": "6 LP - 2. Semester", "color": "bg-cyan-500", "icon": "Terminal"},
    {"title": "Grundlagen der Analysis", "description": "9 LP - 2. Semester", "color": "bg-orange-400", "icon": "LineChart"},
    
    # Semester 3
    {"title": "Theoretische Informatik", "description": "9 LP - 3. Semester", "color": "bg-yellow-400", "icon": "Brain"},
    {"title": "Logik", "description": "9 LP - 3. Semester", "color": "bg-yellow-400", "icon": "Binary"},
    {"title": "Softwaretechnik", "description": "6 LP - 3. Semester", "color": "bg-yellow-400", "icon": "Blocks"},
    {"title": "Grundlagen der Statistik", "description": "6 LP - 3. Semester", "color": "bg-yellow-400", "icon": "BarChart"},
    
    # Semester 4
    {"title": "Systemsoftware und Rechnerkommunikation", "description": "9 LP - 4. Semester", "color": "bg-orange-300", "icon": "Server"},
    {"title": "Datenbanksysteme", "description": "9 LP - 4. Semester", "color": "bg-yellow-300", "icon": "Database"},
    {"title": "Software-Praktikum", "description": "6 LP - 4. Semester", "color": "bg-cyan-400", "icon": "LaptopCode"},
    {"title": "Praktikum zur Statistik", "description": "3 LP - 4. Semester", "color": "bg-cyan-400", "icon": "PieChart"},
    {"title": "Ausg. Th. d. Inform. (SE)", "description": "3 LP - 4. Semester", "color": "bg-yellow-300", "icon": "BookOpen"},
    
    # Semester 5
    {"title": "Informatik Wahlpflichtmodul", "description": "6 LP - 5. Semester", "color": "bg-green-400", "icon": "Library"},
    {"title": "Informatik Wahlpflichtmodul 2", "description": "9 LP - 5. Semester", "color": "bg-green-400", "icon": "Library"},
    {"title": "Fortgeschrittenenpraktikum", "description": "6 LP - 5. Semester", "color": "bg-cyan-300", "icon": "FlaskConical"},
    {"title": "MarSkills-Modul 1", "description": "6 LP - 5. Semester", "color": "bg-gray-300", "icon": "Globe"},
    {"title": "MarSkills-Modul 2", "description": "6 LP - 5. Semester", "color": "bg-gray-300", "icon": "Globe"},
    
    # Semester 6
    {"title": "Informatik Wahlpflichtmodul 3", "description": "9 LP - 6. Semester", "color": "bg-green-300", "icon": "Library"},
    {"title": "Bachelorarbeit", "description": "12 LP - 6. Semester", "color": "bg-purple-500", "icon": "GraduationCap"},
    {"title": "MarSkills-Modul 3", "description": "6 LP - 6. Semester", "color": "bg-gray-300", "icon": "Globe"},
]

def get_or_create_prof():
    user = None
    try:
        res = supabase_admin.auth.admin.create_user({
            "email": PROF_EMAIL,
            "password": PROF_PASSWORD,
            "email_confirm": True,
            "app_metadata": {"role": "professor"}
        })
        user = res.user
        print(f"Created user {PROF_EMAIL}")
    except Exception as e:
        if "already been registered" in str(e):
            print("User already exists. Finding by iterating...")
            page = 1
            while True:
                # the python client list_users returns a list, wait, let me just try listing more if possible
                # actually, I can just query `profiles` or `user_roles` if they have email, but they don't always.
                # let's just query profiles since it's there
                try:
                    profile_res = supabase_admin.table("profiles").select("user_id").eq("email", PROF_EMAIL).execute()
                    if profile_res.data:
                        user_id = profile_res.data[0]['user_id']
                        print(f"Found via profiles: {user_id}")
                        class DummyUser:
                            id = user_id
                        user = DummyUser()
                        break
                except Exception:
                    pass
                
                users_res = supabase_admin.auth.admin.list_users() # unfortunately the python client does not paginate nicely, it returns a generator or list
                for u in users_res:
                    if u.email == PROF_EMAIL:
                        user = u
                        break
                break
            if not user:
                raise Exception("User exists but could not be found.")
        else:
            raise e

    # Ensure role is set in user_roles
    try:
        supabase_admin.table("user_roles").upsert({
            "user_id": user.id,
            "role": "professor"
        }).execute()
    except Exception:
        pass
    
    # Create profile
    try:
        supabase_admin.table("profiles").upsert({
            "user_id": user.id,
            "email": PROF_EMAIL,
            "full_name": "Informatics Professor"
        }).execute()
    except Exception:
        pass
    
    return user.id

def seed():
    prof_id = get_or_create_prof()
    
    print("Deleting existing courses for prof...")
    supabase_admin.table("courses").delete().eq("professor_id", prof_id).execute()
    
    print("Inserting mock courses...")
    db_course_id = None
    inserted_courses = []
    
    for c in COURSES:
        res = supabase_admin.table("courses").insert({
            "professor_id": prof_id,
            "title": c["title"],
            "description": c["description"],
            "color": c["color"],
            "icon": c["icon"]
        }).execute()
        
        c_id = res.data[0]['id']
        inserted_courses.append(c_id)
        if c["title"] == "Datenbanksysteme":
            db_course_id = c_id
            
    print(f"Courses inserted. Datenbanksysteme ID: {db_course_id}")
    
    if db_course_id:
        print("Linking all existing lectures to Datenbanksysteme...")
        # Since we might have different profs for lectures, we will transfer ownership of these lectures to this prof as well
        supabase_admin.table("lectures").update({
            "course_id": db_course_id,
            "professor_id": prof_id
        }).neq("id", "00000000-0000-0000-0000-000000000000").execute()
        
    print("Enroll all students into these courses...")
    roles_res = supabase_admin.table("user_roles").select("user_id").eq("role", "student").execute()
    student_ids = [r["user_id"] for r in roles_res.data]
    
    enrollments = []
    for sid in student_ids:
        for cid in inserted_courses:
            enrollments.append({"user_id": sid, "course_id": cid})
    
    if enrollments:
        print(f"Enrolling {len(student_ids)} students into {len(inserted_courses)} courses...")
        for i in range(0, len(enrollments), 500):
            try:
                supabase_admin.table("course_enrollments").upsert(enrollments[i:i+500], on_conflict="user_id,course_id").execute()
            except Exception as e:
                print(f"Error enrolling batch: {e}")
            
    print("Done!")

if __name__ == "__main__":
    seed()
